import { describe, expect, it, vi } from "vitest";
import type { DbRpc, RpcArgs } from "@/lib/db/rpc";
import { rebuildAfterEvent, rebuildSection, rebuildUploadSection, type SectionWriter } from "./index";
import { uploadExecution } from "@/lib/ingest/workflowContext";
import type { SectionState } from "./types";
import { IncompleteSectionEvidence } from "./draftEvidence";

const state: SectionState = { sectionId: "s", title: "Overview", pageTitle: "ExampleCo", units: [], lines: [] };
const writer: SectionWriter = { name: "test", reviseSection: vi.fn() };

function fakeDb(claims: boolean[], finishes: object[]) {
  const call = vi.fn(async (fn: string, _args?: unknown) => {
    if (fn === "claim_section_build") return { claimed: claims.shift() ?? false };
    if (fn === "read_section_state") return state;
    if (fn === "finish_section_build") return { sectionId: "s", changeNoteId: null, ...finishes.shift() };
    return {};
  });
  return { db: { call: call as DbRpc["call"] }, names: () => call.mock.calls.map(([name]) => name), call };
}

describe("one build per section", () => {
  it.each(["event", null])("redrafts a rejected section locally and saves only the successful attempt (cause: %s)", async (cause) => {
    const { db, call } = fakeDb([true, true, true], [{ rebuildRequested: false }]);
    const prepareSection = vi.fn().mockRejectedValueOnce(new IncompleteSectionEvidence())
      .mockRejectedValueOnce(new IncompleteSectionEvidence()).mockResolvedValue(state);
    const result = await uploadExecution.run({ eventId: "event", token: "owner", db },
      () => rebuildUploadSection(db, { ...writer, prepareSection }, "s", cause));
    expect(result?.rebuildRequested).toBe(false);
    expect(prepareSection).toHaveBeenCalledTimes(3);
    expect(call.mock.calls.filter(([fn]) => fn === "mark_section_stale")).toHaveLength(2);
    expect(call.mock.calls.filter(([fn]) => fn === "finish_section_build")).toHaveLength(1);
  });
  it("bounds local draft retries and never retries an uncertain save", async () => {
    const { db, call } = fakeDb([true, true, true], []);
    const prepareSection = vi.fn().mockRejectedValue(new IncompleteSectionEvidence());
    await expect(uploadExecution.run({ eventId: "event", token: "owner", db },
      () => rebuildUploadSection(db, { ...writer, prepareSection }, "s", "event"))).rejects.toThrow("omits required evidence");
    expect(prepareSection).toHaveBeenCalledTimes(3);
    expect(call.mock.calls.some(([fn]) => fn === "finish_section_build")).toBe(false);
    prepareSection.mockReset().mockResolvedValue(state);
    const next = fakeDb([true], []);
    const original = next.call.getMockImplementation()!;
    next.call.mockImplementation(async (fn, args) => {
      if (fn === "finish_section_build") throw new Error("Connection lost during save");
      return original(fn, args);
    });
    await expect(uploadExecution.run({ eventId: "event", token: "owner", db: next.db },
      () => rebuildUploadSection(next.db, { ...writer, prepareSection }, "s", "event"))).rejects.toThrow("Connection lost during save");
    expect(prepareSection).toHaveBeenCalledTimes(1);
    expect(next.call.mock.calls.filter(([fn]) => fn === "finish_section_build")).toHaveLength(1);
  });
  it("honors cancellation before another local draft attempt", async () => {
    const { db, call } = fakeDb([true], []);
    const abort = new AbortController();
    const prepareSection = vi.fn(async () => { abort.abort(new Error("Cancelled")); throw new IncompleteSectionEvidence(); });
    await expect(uploadExecution.run({ eventId: "event", token: "owner", db, signal: abort.signal },
      () => rebuildUploadSection(db, { ...writer, prepareSection }, "s", "event"))).rejects.toThrow("Cancelled");
    expect(prepareSection).toHaveBeenCalledTimes(1);
    expect(call.mock.calls.some(([fn]) => fn === "finish_section_build")).toBe(false);
  });
  it("keeps the section stale when the writer drops required knowledge", async () => {
    const { db, call } = fakeDb([true], []);
    const original = call.getMockImplementation()!;
    call.mockImplementation(async (name, args) => name === "read_section_state" ? { ...state, units: [{ unitId: "u", revisionId: "r", content: "Saved fact", kind: "fact", epistemicStatus: "established" }] } : original(name, args));
    await expect(rebuildSection(db, { name: "empty", reviseSection: async () => ({ modelVersion: "test", revise: [], retire: [], add: [] }) }, "s", null)).rejects.toThrow("omitted saved knowledge");
    expect(call).toHaveBeenCalledWith("mark_section_stale", { p_section_id: "s" });
    expect(call.mock.calls.some(([name]) => name === "finish_section_build")).toBe(false);
  });
  it.each([false, true])("cleans up after upload cancellation using the section token (replacement owner: %s)", async (replaced) => {
    const abort = new AbortController();
    const call = vi.fn(async (fn: string, args: RpcArgs = {}): Promise<unknown> => {
      if (fn === "assert_upload_lease") { abort.signal.throwIfAborted(); return; }
      if (fn === "claim_section_build") return { claimed: true, buildToken: "original-section-token" };
      if (fn === "read_section_state") return state;
      if (fn === "section_build_write") {
        expect(abort.signal.aborted).toBe(true);
        expect(args).toMatchObject({ p_token: "original-section-token", p_function: "mark_section_stale" });
        return replaced ? { buildCancelled: true } : { sectionId: "s", status: "stale" };
      }
      throw new Error(`Unexpected operation: ${fn}`);
    });
    const db = { call: call as DbRpc["call"] };
    const interrupted: SectionWriter = { ...writer, async prepareSection() {
      abort.abort(new Error("Upload cancelled"));
      throw abort.signal.reason;
    } };
    await expect(uploadExecution.run({ eventId: "event", token: "upload-token", db, signal: abort.signal },
      () => rebuildSection(db, interrupted, "s", "event"))).rejects.toThrow("Upload cancelled");
    expect(call.mock.calls.filter(([fn]) => fn === "section_build_write")).toHaveLength(1);
    expect(call.mock.calls.some(([fn]) => fn === "mark_section_stale")).toBe(false);
  });
  it("waits for a concurrent build and retries without failing the upload", async () => {
    const { db, names } = fakeDb([false, true], [{ rebuildRequested: false }]);
    const result = await uploadExecution.run({ eventId: "event", token: "lease", db }, () => rebuildUploadSection(db, writer, "s", "event"));
    expect(result?.rebuildRequested).toBe(false);
    expect(names().filter((name) => name === "claim_section_build")).toHaveLength(2);
    expect(names().filter((name) => name === "finish_section_build")).toHaveLength(1);
  });
  it("leaves a running build alone and does not touch the section", async () => {
    const { db, names } = fakeDb([false], []);
    expect(await rebuildSection(db, writer, "s", "event")).toBeNull();
    expect(names()).toEqual(["claim_section_build"]);
  });
  it("discards a late AI response when its section was cancelled", async () => {
    const call = vi.fn(async (fn: string) => {
      if (fn === "claim_section_build") return { claimed: true, buildToken: "2026-10-17T00:00:00Z" };
      if (fn === "read_section_state") return { ...state, units: [{ unitId: "u", revisionId: "r", content: "Saved fact", kind: "fact", epistemicStatus: "supported" }] };
      if (fn === "read_page_context") return [];
      if (fn === "section_build_write") return { buildCancelled: true };
      throw new Error(`Unexpected write: ${fn}`);
    });
    const done = vi.fn();
    const reviseSection = vi.fn(async () => ({ modelVersion: "test", revise: [], retire: [], add: [{ text: "Late AI answer", unitIds: ["u"] }] }));
    const result = await rebuildSection({ call: call as DbRpc["call"] }, { name: "test", reviseSection, progress: () => ({ step: vi.fn(), thinking: vi.fn(), draft: vi.fn(), done }) }, "s", null);
    expect(result).toBeNull();
    expect(reviseSection).toHaveBeenCalledOnce();
    expect(call.mock.calls.map(([fn]) => fn)).not.toContain("submit_change_set");
    expect(done).toHaveBeenCalledOnce();
  });
  it("builds again for the event that asked while it ran", async () => {
    const { db, names, call } = fakeDb([true, true], [{ rebuildRequested: true, rebuildEventId: "later" }, { rebuildRequested: false }]);
    await rebuildSection(db, writer, "s", "first");
    expect(names().filter((name) => name === "finish_section_build")).toHaveLength(2);
    expect(call.mock.calls.filter(([name]) => name === "claim_section_build").map(([, args]) => (args as { p_event_id: string }).p_event_id)).toEqual(["first", "later"]);
  });
  it("reviews new knowledge only after all affected sections finish", async () => {
    const { db, call } = fakeDb([true, true], [{ rebuildRequested: false }, { rebuildRequested: false }]);
    const original = db.call;
    db.call = (async (name: string, args?: Record<string, unknown>) => name === "list_affected_sections"
      ? [{ sectionId: "a", pageId: "page" }, { sectionId: "b", pageId: "page" }]
      : original(name, args)) as DbRpc["call"];
    const reviewSections = vi.fn(async () => {
      expect(call.mock.calls.filter(([name]) => name === "finish_section_build")).toHaveLength(2);
    });
    await rebuildAfterEvent(db, { ...writer, reviewSections }, "new-knowledge");
    expect(reviewSections).toHaveBeenCalledExactlyOnceWith(["a", "b"]);
  });
});
