import { beforeEach, expect, it, vi } from "vitest";
import type { DbRpc } from "@/lib/db/rpc";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { uploadExecution } from "@/lib/ingest/workflowContext";
import { AnswerCutOffError } from "@/lib/ai/chat";
import { dictionaryBatches, generateGlossary } from "./generate";
import type { GlossaryEntry } from "./entries";
import type { GlossaryState, GlossaryUpdate } from "./storage";

const { chat, review } = vi.hoisted(() => ({ chat: vi.fn(), review: vi.fn() }));
vi.mock("@/lib/ai/chat", async (original) => ({ ...await original<typeof import("@/lib/ai/chat")>(), chatJson: chat }));
vi.mock("./autoDecide", () => ({ autoDecideGlossary: vi.fn() }));
vi.mock("./dedupe", () => ({ reviewGlossaryDuplicates: review }));
beforeEach(() => {
  chat.mockReset();
  review.mockReset().mockImplementation(async (entries: GlossaryEntry[]) => entries);
});

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
type Request = { subject: string; messages: { content: string }[] };
function answer(request: Request) {
  const knowledge = JSON.parse(request.messages[1]!.content).knowledge as { text: string }[];
  return { value: { entries: [{ term: knowledge[0]!.text, expansion: null, aliases: [], category: "general term", definition: "A source-backed dictionary definition.", citations: ["K1"] }] }, model: "test" };
}
const settings = { apiKey: "test", model: "test" };
const batchClaims = (count: number): Parameters<typeof dictionaryBatches>[0] => Array.from({ length: count }, (_, i) => ({
  id: `unit-${i}`, revisionId: `revision-${i}`, text: "A supported fact.", context: null, sourceEvidence: [],
}));

it("keeps cached batch inputs unchanged when a new unit sorts ahead of them", () => {
  const claims = batchClaims(60);
  const original = dictionaryBatches(claims);
  const plan = original.map((batch) => batch.map((claim) => claim.id));
  const added = { ...claims[0]!, id: "new-unit", revisionId: "new-revision" };
  const next = dictionaryBatches([added, ...claims], plan);
  expect(next.slice(0, original.length)).toEqual(original);
  expect(next.at(-1)).toEqual([added]);
});

it("retains batch order while removing retired units and replacing changed evidence", () => {
  const claims = batchClaims(60);
  const original = dictionaryBatches(claims);
  const plan = original.map((batch) => batch.map((claim) => claim.id));
  const changed = { ...claims[29]!, revisionId: "changed", text: "Changed source evidence." };
  const next = dictionaryBatches(claims.filter((claim) => claim.id !== claims[0]!.id).map((claim) => claim.id === changed.id ? changed : claim), plan);
  expect(next[0]).toEqual(original[0]!.slice(1));
  expect(next[1]).toContainEqual(changed);
  expect(next[2]).toEqual(original[2]);
  expect(next.flat()).toHaveLength(59);
});

it("rechecks prompt size limits when restoring a batch with enlarged claims", () => {
  const claims = batchClaims(3).map((claim) => ({ ...claim, text: "x".repeat(30_000) }));
  expect(dictionaryBatches(claims, [claims.map((claim) => claim.id)])).toHaveLength(3);
});
const published: GlossaryEntry = { term: "Previous dictionary", expansion: null, aliases: [], category: "general term", definition: "The last published dictionary remains available.", context: null, scopeKey: "[null]", citations: [] };

function fixture(count = 140) {
  const ids = Array.from({ length: count }, (_, index) => `u${String(index).padStart(3, "0")}`);
  const state: GlossaryState = { id: true, entries: [published], batches: {}, input_hash: "previous", generated_at: "previous-date", status: "ready", completed_batches: 0, total_batches: 0, error: null, lease_token: null, lease_until: null };
  const writes: GlossaryUpdate[] = [];
  const hooks: { beforeSave?: (values: GlossaryUpdate) => Promise<void | { code: string; message: string }> } = {};
  let lease = 0;
  let version = 0;
  let activeSaves = 0;
  let peakSaves = 0;
  let cancelled = false;
  let abort = new AbortController();
  const db: DbRpc = { async call<T>() {
    if (cancelled) throw new Error("Cancelled");
    return undefined as T;
  } };
  const client = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "publish_glossary_meanings") {
        if (args.p_token !== state.lease_token) throw new Error("Another glossary generation took over");
        const values: GlossaryUpdate = {
          entries: args.p_entries as GlossaryUpdate["entries"], batches: args.p_batches as GlossaryUpdate["batches"],
          input_hash: args.p_hash as string, generated_at: new Date().toISOString(), status: "ready", error: null, lease_token: null, lease_until: null,
        };
        writes.push(structuredClone(values));
        Object.assign(state, structuredClone(values));
        return { data: null, error: null };
      }
      if (name !== "claim_glossary_generation") throw new Error(`Unexpected RPC: ${name}`);
      if (state.lease_token || (!args.p_force && state.status === "ready" && state.input_hash === args.p_hash)) return { data: null, error: null };
      Object.assign(state, { lease_token: `lease-${++lease}`, lease_until: "future", status: "generating", error: null, completed_batches: 0 });
      return { data: state.lease_token, error: null };
    }),
    from(table: string) {
      let selected: string[] = [];
      let range: [number, number] = [0, count];
      let values: GlossaryUpdate | undefined;
      let token: string | undefined;
      return {
        select() { return this; },
        is() { return this; },
        order() { return this; },
        in(_column: string, items: string[]) { selected = items; return this; },
        range(from: number, to: number) { range = [from, to]; return this; },
        eq(column: string, value: string) { if (column === "lease_token") token = value; return this; },
        update(update: GlossaryUpdate) { values = structuredClone(update); return this; },
        async single() { return { data: structuredClone(state), error: null }; },
        async maybeSingle() {
          if (!values) throw new Error("Missing update");
          peakSaves = Math.max(peakSaves, ++activeSaves);
          try {
            const error = await hooks.beforeSave?.(values);
            if (error) return { data: null, error };
            if (token !== state.lease_token) return { data: null, error: null };
            writes.push(structuredClone(values));
            Object.assign(state, structuredClone(values));
            return { data: { id: true }, error: null };
          } finally { activeSaves--; }
        },
        then(resolve: (result: { data: unknown[]; error: null }) => unknown) {
          let data: unknown[];
          if (table === "units") data = ids.slice(range[0], range[1] + 1).map((id) => ({ id, current_revision_id: `${id}:${id === ids[0] ? version : 0}` }));
          else if (table === "revisions") data = selected.map((id) => ({ id, unit_id: id.split(":")[0], content: `Claim ${id}`, passage_ids: [id.split(":")[0]], knowledge_context: null }));
          else if (table === "passages") data = selected.map((id) => ({ id, source_id: "source", text: `Evidence for ${id}` }));
          else if (table === "sources") data = [{ id: "source", title: "Handbook" }];
          else throw new Error(`Unexpected table: ${table}`);
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
    },
  } as unknown as AdminSupabase;
  return {
    client, state, writes, hooks, peakSaves: () => peakSaves,
    run: (force = false) => uploadExecution.run({ eventId: "event", token: "upload", db, signal: abort.signal }, () => generateGlossary(client, settings, force)),
    cancel: () => { cancelled = true; abort.abort(new Error("Cancelled")); },
    resume: () => { cancelled = false; abort = new AbortController(); },
    changeKnowledge: () => { version++; },
    takeover: () => { state.lease_token = "replacement"; state.status = "generating"; },
  };
}

it("bounds concurrency, serializes checkpoints, and publishes once after every batch and duplicate review", async () => {
  const f = fixture();
  const releases = Array.from({ length: 5 }, gate);
  const firstSave = gate();
  const saveStarted = gate();
  let active = 0;
  let peak = 0;
  f.hooks.beforeSave = async (values) => {
    if (values.completed_batches === 1) { saveStarted.resolve(); await firstSave.promise; }
  };
  chat.mockImplementation(async (_settings, request: Request) => {
    peak = Math.max(peak, ++active);
    const index = Number(request.subject.match(/batch (\d+)/)![1]) - 1;
    await releases[index]!.promise;
    active--;
    return answer(request);
  });
  const reviewRelease = gate();
  const reviewStarted = gate();
  review.mockImplementation(async (entries: GlossaryEntry[]) => {
    expect(active).toBe(0);
    expect(Object.keys(f.state.batches)).toHaveLength(5);
    expect(entries.map((entry) => entry.citations[0]!.unitId)).toEqual(["u000", "u028", "u056", "u084", "u112"]);
    reviewStarted.resolve();
    await reviewRelease.promise;
    return entries;
  });
  const running = f.run();
  await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(3));
  // Finish out of order, with an intentionally slow checkpoint write.
  releases[1]!.resolve();
  await saveStarted.promise;
  releases[0]!.resolve(); releases[2]!.resolve();
  await vi.waitFor(() => expect(active).toBe(0));
  expect(f.peakSaves()).toBe(1);
  expect(f.state.entries).toEqual([published]);
  firstSave.resolve();
  await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(5));
  releases[3]!.resolve(); releases[4]!.resolve();
  await reviewStarted.promise;
  expect(f.state.entries).toEqual([published]);
  expect(f.state.generated_at).toBe("previous-date");
  reviewRelease.resolve();
  await running;
  expect(peak).toBe(3);
  expect(f.peakSaves()).toBe(1);
  expect(f.writes.filter((write) => write.batches && !write.entries).map((write) => write.completed_batches)).toEqual([1, 2, 3, 4, 5]);
  expect(f.writes.filter((write) => write.entries)).toHaveLength(1);
  expect(f.state).toMatchObject({ status: "ready", completed_batches: 5, lease_token: null });
});

it("drains failed generation, preserves successful checkpoints, and only regenerates missing batches on resume", async () => {
  const f = fixture();
  const failure = gate();
  const release = gate();
  chat.mockImplementation(async (_settings, request: Request) => {
    if (request.subject.includes("batch 1/")) { await failure.promise; throw new Error("Provider failed"); }
    await release.promise;
    return answer(request);
  });
  let settled = false;
  const running = f.run().finally(() => { settled = true; });
  const rejection = expect(running).rejects.toThrow("Provider failed");
  await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(3));
  failure.resolve();
  // Let the rejected call propagate to the worker while the other calls stay blocked.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(settled).toBe(false);
  expect(f.state.lease_token).not.toBeNull();
  release.resolve();
  await rejection;
  expect(chat).toHaveBeenCalledTimes(3);
  expect(Object.keys(f.state.batches)).toHaveLength(2);
  expect(f.state.entries).toEqual([published]);
  expect(f.state.lease_token).toBeNull();
  expect(review).not.toHaveBeenCalled();

  chat.mockClear().mockImplementation(async (_settings, request: Request) => answer(request));
  await f.run();
  expect(chat.mock.calls.map(([, request]) => request.subject).sort()).toEqual(["Dictionary batch 1/5", "Dictionary batch 4/5", "Dictionary batch 5/5"]);
  expect(f.writes.filter((write) => write.entries)).toHaveLength(1);
});

it("cancels without saving late answers or publishing, releases the lease, and resumes saved batches", async () => {
  const f = fixture();
  const releases = Array.from({ length: 5 }, gate);
  chat.mockImplementation(async (_settings, request: Request) => {
    const index = Number(request.subject.match(/batch (\d+)/)![1]) - 1;
    await releases[index]!.promise;
    return answer(request);
  });
  const running = f.run();
  const rejection = expect(running).rejects.toThrow("Cancelled");
  await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(3));
  releases[0]!.resolve();
  await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(4));
  expect(Object.keys(f.state.batches)).toHaveLength(1);
  f.cancel();
  releases.forEach((release) => release.resolve());
  await rejection;
  expect(chat).toHaveBeenCalledTimes(4);
  expect(Object.keys(f.state.batches)).toHaveLength(1);
  expect(f.state.entries).toEqual([published]);
  expect(f.state).toMatchObject({ lease_token: null, status: "error" });
  expect(review).not.toHaveBeenCalled();

  f.resume();
  chat.mockClear().mockImplementation(async (_settings, request: Request) => answer(request));
  await f.run();
  expect(chat).toHaveBeenCalledTimes(4);
  expect(chat.mock.calls.every(([, request]) => !request.subject.includes("batch 1/"))).toBe(true);
  expect(f.writes.filter((write) => write.entries)).toHaveLength(1);
});

it("does not publish if cancelled during final review, and resumes from all cached batches", async () => {
  const f = fixture(56);
  chat.mockImplementation(async (_settings, request: Request) => answer(request));
  review.mockImplementationOnce(async (entries: GlossaryEntry[]) => { f.cancel(); return entries; });
  await expect(f.run()).rejects.toThrow("Cancelled");
  expect(Object.keys(f.state.batches)).toHaveLength(2);
  expect(f.state.entries).toEqual([published]);
  expect(f.state.lease_token).toBeNull();
  f.resume();
  chat.mockClear();
  const resumedAt = f.writes.length;
  await f.run();
  expect(chat).not.toHaveBeenCalled();
  expect(f.writes.slice(resumedAt).filter((write) => write.batches && !write.entries)).toHaveLength(0);
  expect(f.writes.filter((write) => write.entries)).toHaveLength(1);
});

it("fences checkpoint and cleanup writes when another dictionary generator takes over", async () => {
  const f = fixture(84);
  const release = gate();
  chat.mockImplementation(async (_settings, request: Request) => { await release.promise; return answer(request); });
  const running = f.run();
  const rejection = expect(running).rejects.toThrow("Another glossary generation took over");
  await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(3));
  f.takeover();
  release.resolve();
  await rejection;
  expect(f.state).toMatchObject({ lease_token: "replacement", status: "generating", entries: [published], batches: {} });
  expect(review).not.toHaveBeenCalled();
});

it("rechecks knowledge after review and reuses unchanged batches before one final publish", async () => {
  const f = fixture(84);
  chat.mockImplementation(async (_settings, request: Request) => answer(request));
  review.mockImplementationOnce(async (entries: GlossaryEntry[]) => { f.changeKnowledge(); return entries; });
  await f.run();
  expect(chat).toHaveBeenCalledTimes(4);
  expect(review).toHaveBeenCalledTimes(2);
  expect(f.writes.filter((write) => write.entries)).toHaveLength(1);
  expect(f.state.entries[0]!.citations[0]!.revisionId).toBe("u000:1");
});

it("keeps cutoff retries inside their batch and caches all recovered parts", async () => {
  const f = fixture(28);
  chat.mockImplementationOnce(async () => { throw new AnswerCutOffError("Too long"); })
    .mockImplementation(async (_settings, request: Request) => answer(request));
  await f.run();
  expect(chat).toHaveBeenCalledTimes(3);
  expect(Object.values(f.state.batches)[0]).toHaveLength(2);
  expect(f.state.entries).toHaveLength(2);
  expect(f.writes.filter((write) => write.entries)).toHaveLength(1);
});

it("skips an unchanged dictionary, permits forced regeneration, and works outside uploads", async () => {
  const f = fixture(28);
  chat.mockImplementation(async (_settings, request: Request) => answer(request));
  await generateGlossary(f.client, settings);
  await generateGlossary(f.client, settings);
  expect(chat).toHaveBeenCalledOnce();
  await generateGlossary(f.client, settings, true);
  expect(chat).toHaveBeenCalledTimes(2);
  expect(f.writes.filter((write) => write.entries)).toHaveLength(2);
});

it("retries a failed publication without repeating completed AI comparisons", async () => {
  const f = fixture(28);
  chat.mockImplementation(async (_settings, request: Request) => answer(request));
  const rpc = vi.mocked(f.client.rpc);
  const original = rpc.getMockImplementation()!;
  let fail = true;
  rpc.mockImplementation((...args) => {
    if (String(args[0]) === "publish_glossary_meanings" && fail) {
      fail = false;
      return Promise.resolve({ data: null, error: { code: "XX000", message: "Save unavailable" } }) as ReturnType<typeof original>;
    }
    return original(...args);
  });
  await expect(f.run()).rejects.toThrow("Save unavailable");
  expect(f.state.entries).toEqual([published]);
  await f.run();
  expect(f.state.status).toBe("ready");
  expect(chat).toHaveBeenCalledOnce();
  expect(review).toHaveBeenCalledOnce();
});

it("retries a rolled-back checkpoint timeout without repeating model work", async () => {
  const f = fixture(28);
  chat.mockImplementation(async (_settings, request: Request) => answer(request));
  let failed = false;
  f.hooks.beforeSave = async (values) => {
    if (values.completed_batches === 1 && !failed) {
      failed = true;
      return { code: "57014", message: "canceling statement due to statement timeout" };
    }
  };
  await f.run();
  expect(chat).toHaveBeenCalledTimes(1);
  expect(f.state.status).toBe("ready");
  expect(f.writes.filter((write) => write.entries)).toHaveLength(1);
});

it("bounds timeout retries and releases the lease when checkpoints keep failing", async () => {
  const f = fixture(28);
  let attempts = 0;
  f.hooks.beforeSave = async (values) => {
    if (values.total_batches !== undefined) {
      attempts++;
      return { code: "57014", message: "canceling statement due to statement timeout" };
    }
  };
  await expect(f.run()).rejects.toThrow("statement timeout");
  expect(attempts).toBe(3);
  expect(f.state).toMatchObject({ status: "error", lease_token: null });
  expect(chat).not.toHaveBeenCalled();
});

it("checkpoints review progress without resending unchanged batches or obsolete publications", async () => {
  const f = fixture(28);
  f.state.review_cache = { "publication:obsolete": { large: "old dictionary" }, reusable: { decision: "saved" } };
  chat.mockImplementation(async (_settings, request: Request) => answer(request));
  review.mockImplementationOnce(async (entries, _settings, heartbeat, options) => {
    for (let i = 0; i <= 30; i++) {
      options.decisionCache[`decision-${i}`] = { decision: "different" };
      await heartbeat({ phase: "comparing", completed: i, total: 30 });
    }
    return entries;
  });
  await f.run();
  const checkpoints = f.writes.filter((write) => write.lease_until && write.review_cache);
  expect(checkpoints.length).toBeGreaterThan(0);
  expect(checkpoints.length).toBeLessThanOrEqual(4);
  expect(checkpoints.every((write) => write.batches === undefined)).toBe(true);
  expect(JSON.stringify(f.writes)).not.toContain("publication:obsolete");
  expect(f.state.review_cache?.reusable).toEqual({ decision: "saved" });
  expect(f.state.review_cache?.review_progress).toEqual({ phase: "comparing", completed: 30, total: 30 });
});
