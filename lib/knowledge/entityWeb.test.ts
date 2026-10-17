import { beforeEach, expect, it, vi } from "vitest";
import type { AdminSupabase } from "@/lib/supabase/admin";
import type { DbRpc, RpcArgs } from "@/lib/db/rpc";
import { uploadExecution } from "@/lib/ingest/workflowContext";
import { lookUpNewStakeholders } from "./entityWeb";
const { chat, search, save } = vi.hoisted(() => ({ chat: vi.fn(), search: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/ai/chat", () => ({ chatJson: chat }));
vi.mock("./webSearch", () => ({ searchSnippets: search, webSearchKey: () => "test", wikipediaOfficialSite: vi.fn() }));
vi.mock("./stakeholderExternal", () => ({ saveStakeholderPage: save }));
vi.mock("./logoFetch", () => ({ fetchLogo: vi.fn() }));
beforeEach(() => {
  chat.mockReset().mockImplementation(async (_settings, request) => ({ value: { queries: JSON.parse(request.messages[1].content).stakeholders.map((row: { ref: string; name: string }) => ({ ref: row.ref, query: row.name })) } }));
  search.mockReset(); save.mockReset().mockResolvedValue(undefined);
});
function gate() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  const ids = Array.from({ length: 15 }, (_, index) => `e${String(index).padStart(2, "0")}`);
  const checked = new Map<string, string>();
  const checkpoints = new Map<string, unknown>();
  let abort = new AbortController();
  const db: DbRpc = { async call<T>(name: string, args: RpcArgs = {}) {
    abort.signal.throwIfAborted();
    if (name === "start_upload_step") return { done: checkpoints.has(args.p_key as string), output: checkpoints.get(args.p_key as string) } as T;
    if (name === "finish_upload_step" && args.p_error === null) checkpoints.set(args.p_key as string, args.p_output);
    return undefined as T;
  } };
  const client = {
    rpc: async () => ({ data: { allowExternalKnowledge: true }, error: null }),
    from() {
      let selected = ids;
      return {
        select() { return this; }, eq() { return this; },
        in(_key: string, values: string[]) { selected = values; return this; },
        update(values: { web_hash: string }) { return { eq: async (_key: string, id: string) => { checked.set(id, values.web_hash); return { error: null }; } }; },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: selected.map((id) => ({ entity_id: id, kind: "company", relation: null, key_facts: [], web_hash: checked.get(id) ?? null, logo_url: null,
            entities: { name: id, type: "company", aliases: [], retired_at: null, merged_into_id: null } })), error: null }).then(resolve);
        },
      };
    },
  } as unknown as AdminSupabase;
  return { ids, checked, checkpoints, cancel: () => abort.abort(new Error("Cancelled")), resume: () => { abort = new AbortController(); },
    run: () => uploadExecution.run({ eventId: "event", token: "lease", db, signal: abort.signal }, () => lookUpNewStakeholders({ client, settings: { apiKey: "test" } }, ids)) };
}
it("runs two lookup batches, then imports serially including already-looked-up subjects on resume", async () => {
  const f = fixture();
  const release = gate();
  search.mockImplementation(async () => { await release.promise; return []; });
  save.mockImplementationOnce(async () => { f.cancel(); });
  const running = f.run();
  const rejection = expect(running).rejects.toThrow("Cancelled");
  await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(10));
  expect(chat).toHaveBeenCalledTimes(2);
  expect(save).not.toHaveBeenCalled();
  release.resolve();
  await rejection;
  expect(f.checked.size).toBe(15);
  expect(save).toHaveBeenCalledOnce();
  f.resume(); search.mockClear(); chat.mockClear(); save.mockClear().mockResolvedValue(undefined);
  await f.run();
  expect(search).not.toHaveBeenCalled();
  expect(chat).not.toHaveBeenCalled();
  expect(save.mock.calls.map(([, id]) => id)).toEqual(f.ids);
});
it("drains cancelled searches and prevents new lookup batches and writes", async () => {
  const f = fixture();
  const release = gate();
  search.mockImplementation(async () => { await release.promise; return []; });
  const running = f.run();
  const rejection = expect(running).rejects.toThrow("Cancelled");
  await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(10));
  f.cancel(); release.resolve();
  await rejection;
  expect(chat).toHaveBeenCalledTimes(2);
  expect(f.checked.size).toBe(0);
  expect(save).not.toHaveBeenCalled();
});
