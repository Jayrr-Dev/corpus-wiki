import { beforeEach, expect, it, vi } from "vitest";
import type { DbRpc, RpcArgs } from "@/lib/db/rpc";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { uploadExecution } from "@/lib/ingest/workflowContext";
import { profileInputHash, type ProfileEvidence } from "@/lib/ai/tokenFactory/entityProfiles";
import { profileEventEntities, writeProfileBatch } from "./entityProfiles";
import { resolveProfileKinds } from "./profileKinds";

const { chat, lookup } = vi.hoisted(() => ({ chat: vi.fn(), lookup: vi.fn() }));
vi.mock("@/lib/ai/chat", () => ({ chatJson: chat }));
vi.mock("./entityWeb", () => ({ lookUpNewStakeholders: lookup }));
beforeEach(() => { chat.mockReset(); lookup.mockReset().mockResolvedValue(undefined); });

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
type Request = { name: string; messages: { content: string }[] };
type ProfileInput = { ourOrganization: { name: string; description: string }; kindsInUse: string[]; entities: { name: string; ref: string }[] };
function profileInput(request: Request): ProfileInput { return JSON.parse(request.messages[1]!.content); }
function cardAnswer(request: Request) {
  return { model: "test", value: { profiles: profileInput(request).entities.map((entity) => ({
    ref: entity.ref, isStakeholder: true, kind: ["government agencies", "Government agency.", "regulator", "person", "regulatory body"][Math.floor(Number(entity.name.slice(1)) / 6) % 5],
    relation: "Works with our organization.", keyFacts: [], functions: [], contacts: [], person: null,
  })) } };
}
function kindAnswer(request: Request) {
  const input = JSON.parse(request.messages[1]!.content) as { existing: { ref: string; kind: string }[]; proposed: { ref: string; kind: string }[] };
  return { model: "test", value: { mappings: input.proposed.map((kind) => ({ ref: kind.ref,
    reuseRef: kind.kind === "government agencies" ? input.existing.find((item) => item.kind === "government agency")!.ref
      : kind.kind === "regulatory body" ? input.proposed.find((item) => item.kind === "regulator")!.ref : null,
  })) } };
}
function defaultAnswer(_settings: unknown, request: Request) { return request.name === "entity_profiles" ? cardAnswer(request) : kindAnswer(request); }

type SavedCard = { entity_id: string; input_hash: string | null; kind: string | null; is_stakeholder: boolean; person_contacts?: unknown; hidden?: boolean };
function fixture(count = 30) {
  const ids = Array.from({ length: count }, (_, index) => `e${String(index).padStart(2, "0")}`);
  const evidence = (id: string): ProfileEvidence => ({ entityId: id, type: "organization", name: id, aliases: [], description: "Saved description", related: [],
    claims: [{ unitId: `unit-${id}`, revisionId: `rev-${id}`, title: "", content: "Supported stakeholder fact.", kind: "fact", role: "subject" }] });
  const saved = new Map<string, unknown>();
  const cards = new Map<string, SavedCard>();
  const writes: SavedCard[][] = [];
  const hooks: { beforeSave?: (rows: SavedCard[]) => void | Promise<void>; afterSave?: () => void } = {};
  let anchorDescription = "Original organization context";
  let cancelled = false;
  let abort = new AbortController();
  const call = vi.fn(async (name: string, args: RpcArgs = {}): Promise<unknown> => {
    if (cancelled) throw new Error("Cancelled");
    if (name === "assert_upload_lease") return;
    if (name === "start_upload_step") return { done: saved.has(args.p_key as string), output: structuredClone(saved.get(args.p_key as string)) };
    if (name === "finish_upload_step") {
      if (args.p_error === null) saved.set(args.p_key as string, structuredClone(args.p_output));
      return;
    }
    throw new Error(`Unexpected workflow RPC: ${name}`);
  });
  const db = { call: call as DbRpc["call"] };
  const rpc = vi.fn(async (name: string, args: RpcArgs = {}) => {
    if (name === "event_touched_entities") return { data: [...ids].reverse(), error: null };
    if (name === "get_workspace_settings") return { data: { ourEntityId: "our-org" }, error: null };
    if (name === "entity_profile_evidence") return { data: (args.p_ids as string[]).map(evidence), error: null };
    throw new Error(`Unexpected data RPC: ${name}`);
  });
  const client = {
    rpc,
    from(table: string) {
      let selected: string[] = [];
      let columns = "";
      return {
        select(value: string) { columns = value; return this; },
        in(_column: string, values: string[]) { selected = values; return this; },
        eq() { return this; }, not() { return this; },
        async maybeSingle() { return { data: { name: "Our org", description: anchorDescription }, error: null }; },
        async upsert(rows: SavedCard[]) {
          await hooks.beforeSave?.(rows);
          writes.push(structuredClone(rows));
          rows.forEach((row) => cards.set(row.entity_id, { ...cards.get(row.entity_id), ...row }));
          hooks.afterSave?.();
          return { error: null };
        },
        then(resolve: (result: { data: unknown[]; error: null }) => unknown) {
          if (table !== "entity_profiles") throw new Error(`Unexpected table: ${table}`);
          const data = columns === "kind" ? [...new Set(["company", "government agency", "person", ...[...cards.values()].flatMap((row) => row.kind ?? [])])].map((kind) => ({ kind }))
            : selected.flatMap((id) => cards.has(id) ? [cards.get(id)!] : []);
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
    },
  } as unknown as AdminSupabase;
  const deps = { client, settings: { apiKey: "test" } };
  return {
    ids, deps, saved, cards, writes, hooks, call, rpc, evidence,
    cancel: () => { cancelled = true; abort.abort(new Error("Cancelled")); },
    resume: () => { cancelled = false; abort = new AbortController(); },
    changeAnchor: () => { anchorDescription = "Changed organization context"; },
    run: () => uploadExecution.run({ eventId: "event", token: "lease", db, signal: abort.signal }, () => profileEventEntities(deps, "event")),
  };
}

it("generates up to three batches with a shared organization and vocabulary, reconciles kinds, then saves before web lookup", async () => {
  const f = fixture();
  const started = gate();
  const release = gate();
  let active = 0;
  let peak = 0;
  chat.mockImplementation(async (settings, request: Request) => {
    if (request.name !== "entity_profiles") {
      expect(active).toBe(0);
      expect(f.writes).toHaveLength(0);
      return kindAnswer(request);
    }
    peak = Math.max(peak, ++active);
    if (active === 3) started.resolve();
    await release.promise;
    active--;
    return defaultAnswer(settings, request);
  });
  lookup.mockImplementation(async () => { expect(f.cards.size).toBe(30); });
  const running = f.run();
  await started.promise;
  expect(chat).toHaveBeenCalledTimes(3);
  expect(f.writes).toHaveLength(0);
  expect(lookup).not.toHaveBeenCalled();
  release.resolve();
  await running;
  expect(peak).toBe(3);
  const drafts = chat.mock.calls.filter(([, request]) => request.name === "entity_profiles");
  expect(drafts).toHaveLength(5);
  for (const [, request] of drafts) expect(profileInput(request)).toMatchObject({ ourOrganization: { description: "Original organization context" }, kindsInUse: ["company", "government agency", "person"] });
  expect(f.rpc.mock.calls.filter(([name]) => name === "get_workspace_settings")).toHaveLength(1);
  expect(f.rpc.mock.calls.filter(([name]) => name === "entity_profile_evidence")).toHaveLength(1);
  expect(f.cards.get("e00")!.kind).toBe("government agency");
  expect(f.cards.get("e06")!.kind).toBe("government agency");
  expect(f.cards.get("e12")!.kind).toBe("regulator");
  expect(f.cards.get("e24")!.kind).toBe("regulator");
  expect(lookup).toHaveBeenCalledOnce();
});

it("drains active generation after failure and resumes only missing drafts", async () => {
  const f = fixture();
  const release = gate();
  const fail = gate();
  chat.mockImplementation(async (_settings, request: Request) => {
    if (profileInput(request).entities[0]!.name === "e00") { await fail.promise; throw new Error("Provider failed"); }
    await release.promise;
    return cardAnswer(request);
  });
  let settled = false;
  const running = f.run().finally(() => { settled = true; });
  const rejection = expect(running).rejects.toThrow("Provider failed");
  await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(3));
  fail.resolve();
  await vi.waitFor(() => expect(f.call).toHaveBeenCalledWith("finish_upload_step", expect.objectContaining({ p_error: "Provider failed" })));
  expect(settled).toBe(false);
  release.resolve();
  await rejection;
  expect(chat).toHaveBeenCalledTimes(3);
  expect([...f.saved.keys()].filter((key) => key.startsWith("profiles-draft:"))).toHaveLength(2);
  expect(f.cards.size).toBe(0);
  expect(lookup).not.toHaveBeenCalled();

  chat.mockClear().mockImplementation(defaultAnswer);
  f.changeAnchor();
  await f.run();
  const drafts = chat.mock.calls.filter(([, request]) => request.name === "entity_profiles");
  expect(drafts.map(([, request]) => profileInput(request).entities[0]!.name).sort()).toEqual(["e00", "e18", "e24"]);
  expect(drafts.every(([, request]) => profileInput(request).ourOrganization.description === "Original organization context")).toBe(true);
  expect(f.cards.size).toBe(30);
});

it("blocks late card saves on cancellation and reuses completed draft checkpoints on resume", async () => {
  const f = fixture();
  const releases = Array.from({ length: 5 }, gate);
  chat.mockImplementation(async (_settings, request: Request) => {
    const index = Number(profileInput(request).entities[0]!.name.slice(1)) / 6;
    await releases[index]!.promise;
    return cardAnswer(request);
  });
  const running = f.run();
  const rejection = expect(running).rejects.toThrow("Cancelled");
  await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(3));
  releases[0]!.resolve();
  await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(4));
  f.cancel();
  releases.forEach((release) => release.resolve());
  await rejection;
  expect(chat).toHaveBeenCalledTimes(4);
  expect(f.writes).toHaveLength(0);
  expect([...f.saved.keys()].filter((key) => key.startsWith("profiles-draft:"))).toHaveLength(1);
  expect(lookup).not.toHaveBeenCalled();

  f.resume();
  chat.mockClear().mockImplementation(defaultAnswer);
  await f.run();
  expect(chat.mock.calls.filter(([, request]) => request.name === "entity_profiles")).toHaveLength(4);
  expect(f.cards.size).toBe(30);
});

it("resumes partial card saves without regrouping batches or rerunning generation or kind decisions", async () => {
  const f = fixture();
  chat.mockImplementation(defaultAnswer);
  f.hooks.afterSave = () => { if (f.writes.length === 1) f.cancel(); };
  await expect(f.run()).rejects.toThrow("Cancelled");
  expect(f.cards.size).toBe(6);
  expect(f.saved.has("profiles:kinds")).toBe(true);
  expect(lookup).not.toHaveBeenCalled();

  f.resume();
  chat.mockClear();
  f.hooks.afterSave = undefined;
  await f.run();
  expect(chat).not.toHaveBeenCalled();
  expect(f.cards.size).toBe(30);
  // The first upsert committed but cancellation prevented its checkpoint; a safe
  // repeat writes the same rows, while the other groups keep their original IDs.
  expect(f.writes.map((rows) => rows[0]!.entity_id)).toEqual(["e00", "e00", "e06", "e12", "e18", "e24"]);
  expect(f.rpc.mock.calls.filter(([name]) => name === "event_touched_entities")).toHaveLength(1);
});

it("keeps saved card checkpoints when a later upsert fails", async () => {
  const f = fixture();
  chat.mockImplementation(defaultAnswer);
  f.hooks.beforeSave = (rows) => { if (rows[0]!.entity_id === "e06") throw new Error("Database unavailable"); };
  await expect(f.run()).rejects.toThrow("Database unavailable");
  expect(f.saved.has(`profiles:${f.ids.slice(0, 6).join(":")}`)).toBe(true);
  chat.mockClear();
  f.hooks.beforeSave = undefined;
  await f.run();
  expect(chat).not.toHaveBeenCalled();
  expect(f.writes.map((rows) => rows[0]!.entity_id)).toEqual(["e00", "e06", "e12", "e18", "e24"]);
});

it("skips unchanged cards, preserves personal fields, and supports an explicit rewrite", async () => {
  const f = fixture(1);
  const personal = { person_contacts: [{ kind: "email", value: "saved@example.org" }], hidden: true };
  f.cards.set("e00", { entity_id: "e00", is_stakeholder: true, kind: "government agency", input_hash: profileInputHash(f.evidence("e00"), "our-org"), ...personal });
  chat.mockImplementation(defaultAnswer);
  expect(await writeProfileBatch(f.deps, ["e00"])).toEqual({ written: 0, skipped: 1 });
  expect(chat).not.toHaveBeenCalled();
  expect(await writeProfileBatch(f.deps, ["e00"], true)).toEqual({ written: 1, skipped: 0 });
  expect(f.cards.get("e00")).toMatchObject(personal);
  expect(f.writes[0]![0]).not.toHaveProperty("person_contacts");
  expect(f.writes[0]![0]).not.toHaveProperty("hidden");
});

it("does no model work for an upload without entities", async () => {
  const f = fixture(0);
  await f.run();
  expect(chat).not.toHaveBeenCalled();
  expect(f.writes).toHaveLength(0);
});

it.each(["unknown", "forward", "duplicate", "omitted"])("rejects %s kind mappings without saving cards and retries kinds using cached drafts", async (invalid) => {
  const f = fixture();
  chat.mockImplementation((settings, request: Request) => {
    if (request.name === "entity_profiles") return defaultAnswer(settings, request);
    const answer = kindAnswer(request);
    if (invalid === "unknown") answer.value.mappings[0]!.reuseRef = "C999";
    if (invalid === "forward") answer.value.mappings[0]!.reuseRef = "K2";
    if (invalid === "duplicate") answer.value.mappings.push(answer.value.mappings[0]!);
    if (invalid === "omitted") answer.value.mappings.pop();
    return answer;
  });
  await expect(f.run()).rejects.toThrow(/stakeholder kind/i);
  expect(f.writes).toHaveLength(0);
  expect(f.saved.has("profiles:kinds")).toBe(false);
  expect(lookup).not.toHaveBeenCalled();
  chat.mockClear().mockImplementation(defaultAnswer);
  await f.run();
  expect(chat).toHaveBeenCalledOnce();
  expect(chat.mock.calls[0]![1].name).toBe("entity_profile_kinds");
  expect(f.cards.size).toBe(30);
});

it("cancels during kind reconciliation without saving cards, then resumes cached drafts", async () => {
  const f = fixture();
  chat.mockImplementation((settings, request: Request) => {
    if (request.name === "entity_profile_kinds") f.cancel();
    return defaultAnswer(settings, request);
  });
  await expect(f.run()).rejects.toThrow("Cancelled");
  expect(f.writes).toHaveLength(0);
  expect([...f.saved.keys()].filter((key) => key.startsWith("profiles-draft:"))).toHaveLength(5);
  expect(lookup).not.toHaveBeenCalled();
  f.resume();
  chat.mockClear().mockImplementation(defaultAnswer);
  await f.run();
  expect(chat).toHaveBeenCalledOnce();
  expect(f.cards.size).toBe(30);
});

it("shares canonical kinds across bounded reconciliation calls without conflating distinct kinds", async () => {
  const f = fixture();
  chat.mockImplementation((_settings, request: Request) => {
    if (request.name === "entity_profiles") {
      const answer = cardAnswer(request);
      answer.value.profiles.forEach((row, index) => { row.kind = `category-${profileInput(request).entities[index]!.name}`; });
      return answer;
    }
    const input = JSON.parse(request.messages[1]!.content) as { existing: { ref: string; kind: string }[]; proposed: { ref: string; kind: string }[] };
    expect(input.proposed.length).toBeLessThanOrEqual(24);
    return { model: "test", value: { mappings: input.proposed.map((row) => ({ ref: row.ref,
      reuseRef: row.kind === "category-e29" ? input.existing.find((kind) => kind.kind === "category-e00")!.ref : null,
    })) } };
  });
  await f.run();
  expect(chat.mock.calls.filter(([, request]) => request.name === "entity_profile_kinds")).toHaveLength(2);
  expect(f.cards.get("e29")!.kind).toBe("category-e00");
  expect(f.cards.get("e28")!.kind).toBe("category-e28");
});

it("reuses formatting-equivalent existing kinds without a model call", async () => {
  const rows = [{ entityId: "e", isStakeholder: true, kind: " GOVERNMENT   AGENCY. ", relation: null, keyFacts: [], functions: [], contacts: [], person: null }];
  expect(await resolveProfileKinds(rows, ["government agency"], { apiKey: "test" })).toEqual({ "government agency": "government agency" });
  expect(chat).not.toHaveBeenCalled();
});
