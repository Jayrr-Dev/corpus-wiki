import { afterEach, expect, it, vi } from "vitest";
import type { DbRpc, RpcArgs } from "@/lib/db/rpc";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { uploadExecution } from "@/lib/ingest/workflowContext";
import { runModuleForEvent } from "@/lib/processing/moduleUpkeep";
import { describeEventEntities } from "./entityDescriptions";

const { chat } = vi.hoisted(() => ({ chat: vi.fn() }));
vi.mock("@/lib/ai/chat", () => ({ chatJson: chat }));
vi.mock("@/lib/auth/currentPerson", () => ({ withSettledActor: (run: () => unknown) => run() }));
vi.mock("@/lib/living-page", () => ({ holdForReviewerBudget: vi.fn(async () => false), proposePages: vi.fn(), rebuildAfterEvent: vi.fn() }));
vi.mock("@/lib/change-control", () => ({ commitAsRole: vi.fn() }));
afterEach(() => vi.clearAllMocks());

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

type Request = { messages: { content: string }[] };
function requestedEntities(request: Request): { ref: string; name: string }[] {
  return JSON.parse(request.messages[1]!.content).entities;
}
function answer(request: Request) {
  return { value: { descriptions: requestedEntities(request).map((entity) => ({ ref: entity.ref, description: `Evidence about ${entity.name}.` })) }, model: "test" };
}

function fixture(count = 50) {
  const ids = Array.from({ length: count }, (_, index) => `e${String(index).padStart(2, "0")}`);
  const saved = new Map<string, unknown>();
  const writes: string[] = [];
  const cleared: string[] = [];
  const abort = new AbortController();
  let cancelled = false;
  let state = "running";
  const commit = { changeSetId: "change", status: "applied" as const, applied: 0, exceptions: 0, rejected: 0, eventStatus: "applied" as const };
  const call = vi.fn(async (name: string, args: RpcArgs = {}): Promise<unknown> => {
    if (cancelled && ["assert_upload_lease", "start_upload_step", "finish_upload_step"].includes(name)) throw new Error("Cancelled");
    if (name === "assert_upload_lease") return;
    if (name === "start_upload_step") return { done: saved.has(args.p_key as string), output: saved.get(args.p_key as string) };
    if (name === "finish_upload_step") {
      if (args.p_error === null) saved.set(args.p_key as string, args.p_output);
      return;
    }
    if (name === "claim_upload_workflow") return { claimed: true, token: "lease" };
    if (name === "upload_workflow_waiting") return false;
    if (name === "upload_article_inputs") return [];
    if (name === "release_upload_workflow") { state = args.p_state as string; return false; }
    if (name === "upload_knowledge_result") return commit;
    if (name === "read_upload_workflows") return [{ event_id: "event", state, steps: [], waiting: false, lease_until: null, change_set_id: "change" }];
    throw new Error(`Unexpected RPC: ${name}`);
  });
  const db = { call: call as DbRpc["call"] };
  const client = {
    // Stale description marks for every fixture entity; clearing records what was read
    rpc: vi.fn(async (name: string, args: RpcArgs = {}) => {
      if (name === "read_stale_entities") return { data: { entityIds: [...ids].reverse(), marks: ids.map((id) => ({ kind: "entity_description", key: id, version: 1 })) }, error: null };
      if (name === "clear_stale_marks") { cleared.push(...(args.p_marks as { key: string }[]).map((mark) => mark.key)); return { data: null, error: null }; }
      throw new Error(`Unexpected data RPC: ${name}`);
    }),
    from(table: string) {
      let selected: string[] = [];
      return {
        select() { return this; },
        in(_column: string, values: string[]) { selected = values; return this; },
        is() { return this; },
        update() {
          return { eq: async (_column: string, id: string) => { writes.push(id); return { error: null }; } };
        },
        then(resolve: (result: { data: unknown[]; error: null }) => unknown) {
          const data = selected.map((id) => {
            if (table === "entities") return { id, name: id, type: "concept", aliases: [] };
            if (table === "unit_entities") return { entity_id: id, unit_id: id };
            if (table === "units") return { id, current_revision_id: id };
            if (table === "revisions") return { id, content: `Supported claim for ${id}.`, passage_ids: [] };
            throw new Error(`Unexpected table: ${table}`);
          });
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
    },
  } as unknown as AdminSupabase;
  const deps = { client, settings: { apiKey: "test" } };
  return {
    db, call, deps, ids, saved, writes, cleared,
    cancel: () => { cancelled = true; abort.abort(new Error("Cancelled")); },
    resume: () => { cancelled = false; },
    run: (signal: AbortSignal = abort.signal) => uploadExecution.run({ eventId: "event", token: "lease", db, signal }, () => describeEventEntities(deps, "event")),
    // The Entities module after an upload: descriptions, then stakeholder cards (lib/processing/moduleUpkeep.ts)
    workflow: (profiles: () => Promise<void>) => uploadExecution.run({ eventId: "event", token: "lease", db, signal: abort.signal }, () => runModuleForEvent({
      db, reconciler: { name: "test", draftChangeSet: vi.fn() }, writer: { name: "test", reviseSection: vi.fn() },
      entityDescriber: () => describeEventEntities(deps, "event"), profileWriter: profiles,
    }, "entities", "event")),
  };
}

it("runs at most three disjoint description batches and waits for all saves before cards", async () => {
  const f = fixture();
  const started = gate();
  const release = gate();
  let active = 0;
  let peak = 0;
  chat.mockImplementation(async (_settings, request: Request) => {
    peak = Math.max(peak, ++active);
    if (active === 3) started.resolve();
    await release.promise;
    active--;
    return answer(request);
  });
  const profiles = vi.fn(async () => {
    expect(active).toBe(0);
    expect([...f.writes].sort()).toEqual(f.ids);
  });
  const running = f.workflow(profiles);
  await started.promise;
  expect(chat).toHaveBeenCalledTimes(3);
  expect(profiles).not.toHaveBeenCalled();
  expect(chat.mock.calls.map(([, request]) => requestedEntities(request)[0]!.name)).toEqual(["e00", "e10", "e20"]);
  release.resolve();
  await running;
  expect(peak).toBe(3);
  expect(chat).toHaveBeenCalledTimes(5);
  expect(profiles).toHaveBeenCalledOnce();
});

it("stops scheduling after failure, drains other batches, and resumes without repeating saved batches", async () => {
  const f = fixture();
  const started = gate();
  const fail = gate();
  const release = gate();
  let arrivals = 0;
  chat.mockImplementation(async (_settings, request: Request) => {
    if (++arrivals === 3) started.resolve();
    if (requestedEntities(request)[0]!.name === "e00") {
      await fail.promise;
      throw new Error("Provider failed");
    }
    await release.promise;
    return answer(request);
  });
  let settled = false;
  const running = f.run().finally(() => { settled = true; });
  const rejection = expect(running).rejects.toThrow("Provider failed");
  await started.promise;
  fail.resolve();
  await vi.waitFor(() => expect(f.call).toHaveBeenCalledWith("finish_upload_step", expect.objectContaining({ p_error: "Provider failed" })));
  expect(settled).toBe(false);
  release.resolve();
  await rejection;
  expect(chat).toHaveBeenCalledTimes(3);
  expect([...f.writes].sort()).toEqual(f.ids.slice(10, 30));

  chat.mockClear();
  chat.mockImplementation(async (_settings, request: Request) => answer(request));
  await f.run();
  expect(chat.mock.calls.map(([, request]) => requestedEntities(request)[0]!.name).sort()).toEqual(["e00", "e30", "e40"]);
  expect([...f.writes].sort()).toEqual(f.ids);
});

it("prevents late description saves after cancellation and resumes completed checkpoints", async () => {
  const f = fixture();
  const firstKey = `describe:${f.ids.slice(0, 10).join(":")}`;
  f.saved.set(firstKey, { described: 10, skipped: 0 });
  const started = gate();
  const release = gate();
  let arrivals = 0;
  chat.mockImplementation(async (_settings, request: Request) => {
    if (++arrivals === 3) started.resolve();
    await release.promise;
    return answer(request);
  });
  let settled = false;
  const running = f.run().finally(() => { settled = true; });
  const rejection = expect(running).rejects.toThrow("Cancelled");
  await started.promise;
  f.cancel();
  expect(settled).toBe(false);
  release.resolve();
  await rejection;
  expect(chat).toHaveBeenCalledTimes(3);
  expect(f.writes).toEqual([]);
  expect(f.saved.size).toBe(2); // The first batch and the frozen marks

  f.resume();
  chat.mockClear();
  chat.mockImplementation(async (_settings, request: Request) => answer(request));
  await f.run(new AbortController().signal);
  expect(chat).toHaveBeenCalledTimes(4);
  expect([...f.writes].sort()).toEqual(f.ids.slice(10));
});

it("does no model work for an upload without touched entities", async () => {
  const f = fixture(0);
  await f.run();
  expect(chat).not.toHaveBeenCalled();
  expect(f.writes).toEqual([]);
});

it("describes the marked entities and clears only the marks it read, after every save", async () => {
  const f = fixture(12);
  chat.mockImplementation(async (_settings, request: Request) => answer(request));
  await f.run();
  expect([...f.writes].sort()).toEqual(f.ids);
  expect([...f.cleared].sort()).toEqual(f.ids);
});

it("keeps the marks when a batch fails, so the next run describes them again", async () => {
  const f = fixture(12);
  chat.mockRejectedValue(new Error("Provider down"));
  await expect(f.run()).rejects.toThrow("Provider down");
  expect(f.cleared).toEqual([]);
});
