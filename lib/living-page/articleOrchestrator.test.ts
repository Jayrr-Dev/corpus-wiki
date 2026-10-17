import { afterEach, expect, it, vi } from "vitest";
import type { DbRpc, RpcArgs } from "@/lib/db/rpc";
import { uploadExecution } from "@/lib/ingest/workflowContext";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { orchestrateEventArticles } from "./articleOrchestrator";

afterEach(() => vi.unstubAllGlobals());

it.each(["audit", "commit"])("does not complete an upload proposal after a failed %s", async (failure) => {
  let failRecord = failure === "audit";
  const records: unknown[] = [];
  const tables: Record<string, unknown> = {
    units: [{ id: "u1", current_revision_id: "r1", kind: "fact", epistemic_status: "supported" }],
    revisions: [{ id: "r1", content: "A supported fact.", knowledge_context: null }],
    unit_entities: [], unit_domains: [], pages: { title: "Existing article" }, sections: [], section_lines: [],
  };
  const client = { from: (table: string) => {
    const query = { select: () => query, eq: () => query, is: () => query, in: () => query, neq: () => query, order: () => query, single: () => query,
      insert: async (row: unknown) => {
        if (failRecord) { failRecord = false; return { error: { message: "Audit storage unavailable" } }; }
        records.push(row); return { error: null };
      }, then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: tables[table], error: null })) };
    return query;
  } } as unknown as AdminSupabase;
  const steps = new Map<string, unknown>();
  const writes = new Map<string, unknown>();
  let commits = 0;
  const db: DbRpc = { async call<T>(name: string, args: RpcArgs = {}) {
    if (name === "living_page_event_units") return ["u1"] as T;
    if (name === "article_index") return [{ id: "page" }] as T;
    if (name === "get_workspace_settings") return {} as T;
    const key = String(args.p_key);
    if (name === "start_upload_step") return { done: steps.has(key), output: steps.get(key) } as T;
    if (name === "finish_upload_step") { if (!args.p_error) steps.set(key, args.p_output); return null as T; }
    if (name === "upload_workflow_write") {
      if (writes.has(key)) return writes.get(key) as T;
      const result = args.p_function === "submit_change_set" ? { changeSetId: "proposal" }
        : (++commits, { status: failure === "commit" ? "partly_applied" : "applied", applied: 1, rejected: failure === "commit" ? 1 : 0, exceptions: 0 });
      writes.set(key, result); return result as T;
    }
    throw new Error(`Unexpected database call ${name}`);
  } };
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    const value = request.response_format.json_schema.name === "article_proposals"
      ? { proposals: [{ action: "update", pageId: "page", title: "", type: null, scope: "", parentPageId: null, entity: null, claims: ["C1"] }] }
      : { sections: [{ title: "Supported knowledge", claims: ["C1"] }] };
    return new Response(JSON.stringify({ model: "test", usage: { prompt_tokens: 1, completion_tokens: 1 }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] }));
  }));
  const run = () => uploadExecution.run({ eventId: "upload", token: "owner", db }, () => orchestrateEventArticles({ db, client, settings: { apiKey: "test" }, embedder: null }, "upload"));
  await expect(run()).rejects.toThrow(failure === "audit" ? "Audit storage unavailable" : "Article proposal was not fully applied");
  expect(records).toHaveLength(0);
  if (failure === "audit") {
    await expect(run()).resolves.toMatchObject({ updated: 1 });
    expect(records).toHaveLength(1);
    expect(commits).toBe(1);
  }
});

it.each([2, 3])("retries failed upload proposals for %i claims while reusing completed proposals and keeping reference validation", async (claimCount) => {
  const units = Array.from({ length: claimCount }, (_, index) => index + 1).map((id) => ({ id: `u${id}`, current_revision_id: `r${id}`, kind: "fact", epistemic_status: "established" }));
  const tables: Record<string, unknown> = {
    units, revisions: units.map((unit) => ({ id: unit.current_revision_id, content: `Fact ${unit.id}`, knowledge_context: null })),
    unit_entities: [], unit_domains: [], pages: { title: "Existing article" }, sections: [], section_lines: [],
  };
  const records: Record<string, unknown>[] = [];
  const client = { from: (table: string) => {
    const chain = {
      select: () => chain, eq: () => chain, is: () => chain, in: () => chain, neq: () => chain, order: () => chain, single: () => chain,
      insert: async (row: Record<string, unknown>) => { records.push(row); return { error: null }; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: tables[table], error: null })),
    };
    return chain;
  } } as unknown as AdminSupabase;
  const checkpoints = new Map<string, { state: string; output: unknown }>();
  // Match a jsonb round trip: nested object-key order differs from model output.
  const jsonb = (value: unknown): unknown => Array.isArray(value) ? value.map(jsonb)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, part]) => [key, jsonb(part)])) : value;
  const call = vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
    if (name === "living_page_event_units") return units.map((unit) => unit.id);
    if (name === "article_index") return [{ id: "page-a" }, { id: "page-b" }];
    if (name === "get_workspace_settings") return {};
    if (name === "assert_upload_lease") return null;
    const key = String(args.p_key);
    if (name === "start_upload_step") {
      const prior = checkpoints.get(key);
      return { done: prior?.state === "succeeded", output: prior?.output };
    }
    if (name === "finish_upload_step") {
      checkpoints.set(key, { state: args.p_error ? "failed" : "succeeded", output: jsonb(args.p_output) });
      return null;
    }
    throw new Error(`Unexpected database call: ${name}`);
  });
  const db = { call: call as DbRpc["call"] };
  const proposal = (pageId: string, claims: string[]) => ({ action: "update", pageId, title: "", type: null, scope: "", parentPageId: null, entity: null, claims });
  const answer = (value: unknown) => new Response(JSON.stringify({ model: "test", usage: { prompt_tokens: 10, completion_tokens: 5 },
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] }));
  const invalid = { sections: [{ title: "Unknown claims", claims: ["C99"] }] };
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(answer({ proposals: [proposal("page-a", claimCount === 2 ? ["C1"] : ["C1", "C2"]), proposal("page-b", [`C${claimCount}`])] }))
    .mockResolvedValueOnce(answer(invalid)).mockResolvedValueOnce(answer(invalid))
    .mockResolvedValueOnce(answer({ sections: [] })).mockResolvedValueOnce(answer({ sections: [] }));
  vi.stubGlobal("fetch", fetcher);
  const deps = { db, client, settings: { apiKey: "test" }, embedder: null };
  const run = () => uploadExecution.run({ eventId: "upload", token: "owner", db }, () => orchestrateEventArticles(deps, "upload"));
  await expect(run()).rejects.toThrow("invalid claim fields");
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ verdict: "update_existing", result_page_id: "page-b" });
  expect([...checkpoints.values()].filter((step) => step.state === "failed")).toHaveLength(1);
  expect(await run()).toMatchObject({ updated: 2, rejected: 0, pageIds: ["page-a", "page-b"] });
  expect(records).toHaveLength(2);
  expect(records.every((row) => row.verdict === "update_existing")).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(5);
  expect([...checkpoints.values()].every((step) => step.state === "succeeded")).toBe(true);
});
