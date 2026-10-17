import { expect, it, vi } from "vitest";
import type { DbRpc, RpcArgs } from "@/lib/db/rpc";
import { uploadExecution } from "@/lib/ingest/workflowContext";
import { rebuildAfterEvent, type SectionRef, type SectionState, type SectionWriter } from "./index";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture(sections: SectionRef[]) {
  const saved = new Map<string, unknown>();
  const builds: string[] = [];
  const progress: number[] = [];
  const abort = new AbortController();
  let cancelled = false;
  const call = vi.fn(async (name: string, args: RpcArgs = {}): Promise<unknown> => {
    if (cancelled && ["assert_upload_lease", "start_upload_step", "finish_upload_step", "report_upload_progress"].includes(name)) throw new Error("Cancelled");
    if (name === "start_upload_step") return { done: saved.has(args.p_key as string), output: saved.get(args.p_key as string) };
    if (name === "finish_upload_step") {
      if (args.p_error === null) saved.set(args.p_key as string, args.p_output);
      return;
    }
    if (name === "assert_upload_lease" || name === "mark_section_stale") return;
    if (name === "report_upload_progress") {
      progress.push((args.p_progress as { done: number }).done);
      return;
    }
    if (name === "list_affected_sections") return sections;
    if (name === "claim_section_build") {
      builds.push(args.p_section_id as string);
      return { claimed: true };
    }
    if (name === "read_section_state") return { sectionId: args.p_section_id, title: "Section", pageTitle: "Page", units: [], lines: [] };
    if (name === "finish_section_build") return { sectionId: args.p_section_id, changeNoteId: null, rebuildRequested: false };
    throw new Error(`Unexpected RPC: ${name}`);
  });
  const db = { call: call as DbRpc["call"] };
  const reviewSections = vi.fn(async () => {});
  const writer: SectionWriter = { name: "test", reviseSection: vi.fn(), reviewSections };
  return {
    db, call, writer, builds, progress, saved, reviewSections,
    cancel: () => { cancelled = true; abort.abort(new Error("Cancelled")); },
    resume: () => { cancelled = false; },
    run: (signal: AbortSignal = abort.signal) => uploadExecution.run({ eventId: "event", token: "lease", db, signal }, () => rebuildAfterEvent(db, writer, "event")),
  };
}

it("overlaps at most three pages, preserves sibling order, and reviews after all builds", async () => {
  // Interleave the input to verify grouping preserves each page's original order.
  const sections = [
    { pageId: "a", sectionId: "a1" }, { pageId: "b", sectionId: "b1" },
    { pageId: "a", sectionId: "a2" }, { pageId: "c", sectionId: "c1" },
    { pageId: "b", sectionId: "b2" }, { pageId: "d", sectionId: "d1" },
  ];
  const f = fixture(sections);
  const started = gate();
  const release = gate();
  const finished: string[] = [];
  let active = 0;
  let peak = 0;
  f.writer.prepareSection = async (state) => {
    peak = Math.max(peak, ++active);
    if (state.sectionId === "a2") expect(finished).toContain("a1");
    if (state.sectionId === "b2") expect(finished).toContain("b1");
    if (active === 3) started.resolve();
    await release.promise;
    finished.push(state.sectionId);
    active--;
    return state;
  };
  f.reviewSections.mockImplementation(async () => {
    expect(finished).toHaveLength(sections.length);
    expect(active).toBe(0);
  });
  const running = f.run();
  await started.promise;
  expect(f.builds).toEqual(["a1", "b1", "c1"]);
  expect(f.reviewSections).not.toHaveBeenCalled();
  release.resolve();
  await running;
  expect(peak).toBe(3);
  expect(f.progress).toEqual([0, 1, 2, 3, 4, 5, 6]);
  expect(f.reviewSections).toHaveBeenCalledExactlyOnceWith(sections.map((section) => section.sectionId));
});

it("stops new sections on failure, drains active builds, and resumes only unfinished checkpoints", async () => {
  const sections = [
    { pageId: "a", sectionId: "a1" }, { pageId: "a", sectionId: "a2" },
    { pageId: "b", sectionId: "b1" }, { pageId: "b", sectionId: "b2" },
    { pageId: "c", sectionId: "c1" }, { pageId: "c", sectionId: "c2" },
    { pageId: "d", sectionId: "d1" },
  ];
  const f = fixture(sections);
  const release = gate();
  const started = gate();
  let arrivals = 0;
  f.writer.prepareSection = async (state) => {
    if (++arrivals === 3) started.resolve();
    if (state.sectionId === "a1") throw new Error("Writer failed");
    await release.promise;
    return state;
  };
  let settled = false;
  const running = f.run().finally(() => { settled = true; });
  const rejection = expect(running).rejects.toThrow("Writer failed");
  await started.promise;
  // The rejected checkpoint is recorded before its failure reaches the scheduler.
  await vi.waitFor(() => expect(f.call).toHaveBeenCalledWith("finish_upload_step", expect.objectContaining({ p_error: "Writer failed" })));
  expect(settled).toBe(false);
  release.resolve();
  await rejection;
  expect(f.builds).toEqual(["a1", "b1", "c1"]);
  expect(f.saved.has("rebuild-section:event:b1")).toBe(true);
  expect(f.saved.has("rebuild-section:event:c1")).toBe(true);
  expect(f.reviewSections).not.toHaveBeenCalled();

  f.writer.prepareSection = async (state) => state;
  f.builds.length = 0;
  await f.run();
  expect([...f.builds].sort()).toEqual(["a1", "a2", "b2", "c2", "d1"]);
  expect(f.call.mock.calls.filter(([name]) => name === "list_affected_sections")).toHaveLength(1);
  expect(f.reviewSections).toHaveBeenCalledOnce();
  expect(f.progress.at(-1)).toBe(sections.length);
});

it("cancels concurrent work before later sections or review and resumes saved sections", async () => {
  const f = fixture([
    { pageId: "a", sectionId: "a1" }, { pageId: "a", sectionId: "a2" },
    { pageId: "b", sectionId: "b1" }, { pageId: "b", sectionId: "b2" },
    { pageId: "c", sectionId: "c1" },
  ]);
  // a1 was completed by an earlier attempt; its sibling is still pending.
  f.saved.set("rebuild-section:event:a1", { rebuildRequested: false });
  const started = gate();
  const release = gate();
  let arrivals = 0;
  f.writer.prepareSection = async (state: SectionState) => {
    if (++arrivals === 3) started.resolve();
    await release.promise;
    return state;
  };
  let settled = false;
  const running = f.run().finally(() => { settled = true; });
  const rejection = expect(running).rejects.toThrow("Cancelled");
  await started.promise;
  f.cancel();
  expect(settled).toBe(false);
  release.resolve();
  await rejection;
  expect(f.builds).not.toContain("a1");
  expect(f.builds).not.toContain("b2");
  expect(f.call.mock.calls.filter(([name]) => name === "finish_section_build")).toHaveLength(0);
  expect(f.reviewSections).not.toHaveBeenCalled();

  f.resume();
  f.writer.prepareSection = async (state) => state;
  f.builds.length = 0;
  await f.run(new AbortController().signal);
  expect([...f.builds].sort()).toEqual(["a2", "b1", "b2", "c1"]);
  expect(f.reviewSections).toHaveBeenCalledOnce();
});
