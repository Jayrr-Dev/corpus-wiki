import { expect, it, vi } from "vitest";
import { runDispatches } from "./dispatch";
import { discoverArticleUpdates } from "@/lib/living-page/discoverArticleUpdates";
import { rebuildPage } from "@/lib/living-page";
import { uploadExecution } from "@/lib/ingest/workflowContext";
import type { DbRpc, RpcArgs } from "@/lib/db/rpc";
import type { AdminSupabase } from "@/lib/supabase/admin";
import type { Dispatch } from "./plan";
import { FakeSectionWriter } from "@/lib/living-page/writers/fake";
import { forceCreateSection, NoSectionKnowledgeError } from "@/lib/living-page/forceCreateSection";

vi.mock("@/lib/living-page", () => ({ rebuildPage: vi.fn() }));
vi.mock("@/lib/living-page/refreshOrganizationOverviews", () => ({ refreshOrganizationOverviews: vi.fn(async () => []) }));
vi.mock("@/lib/living-page/discoverArticleUpdates", () => ({ discoverArticleUpdates: vi.fn(async () => ({ sections: [{ title: "New knowledge", query: { unitIds: ["claim"], article: true } }] })) }));
vi.mock("@/lib/living-page/forceCreateSection", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/living-page/forceCreateSection")>(), forceCreateSection: vi.fn(),
}));

it.each([false, true])("removes research headings only for a completed search with no fitting knowledge (empty=%s)", async (empty) => {
  const actions: string[] = [];
  const db: DbRpc = { async call<T>(name: string, args: RpcArgs = {}) {
    if (name === "get_workspace_settings") return { allowExternalKnowledge: false } as T;
    if (name === "submit_change_set") {
      actions.push((args.p_actions as { type: string }[])[0]!.type);
      return { changeSetId: "research" } as T;
    }
    return { status: "applied", applied: 1, rejected: 0 } as T;
  } };
  const client = { from: () => {
    const query = { select: () => query, eq: () => query, single: async () => ({ data: { target_id: "section" }, error: null }) };
    return query;
  } } as unknown as AdminSupabase;
  vi.mocked(forceCreateSection).mockRejectedValueOnce(empty ? new NoSectionKnowledgeError("No matching evidence") : new Error("Provider unavailable"));
  const outcomes = await runDispatches({ db, client, settings: { apiKey: "test" }, writer: new FakeSectionWriter() },
    [{ role: "researcher", pageId: "page", heading: "Missing subject", note: "", reason: "", claimIds: [] }]);
  expect(actions).toEqual(empty ? ["create_section", "retire_section"] : ["create_section"]);
  expect(outcomes[0]?.status).toBe(empty ? "nothing" : "failed");
});

it("retries only a failed dispatch and reuses its committed outline across jsonb key reordering", async () => {
  const jsonb = (value: unknown): unknown => Array.isArray(value) ? value.map(jsonb) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, part]) => [key, jsonb(part)])) : value;
  const steps = new Map<string, unknown>();
  const writes = new Map<string, unknown>();
  let submits = 0;
  const db: DbRpc = { async call<T>(name: string, args: RpcArgs = {}) {
    const key = String(args.p_key);
    if (name === "start_upload_step") return { done: steps.has(key), output: steps.get(key) } as T;
    if (name === "finish_upload_step") { if (!args.p_error) steps.set(key, jsonb(args.p_output)); return null as T; }
    if (name === "upload_workflow_write") {
      if (writes.has(key)) return writes.get(key) as T;
      const result = args.p_function === "submit_change_set" ? { changeSetId: `outline-${++submits}` } : { status: "applied", applied: 1, rejected: 0 };
      writes.set(key, result); return result as T;
    }
    throw new Error(`Unexpected call ${name}`);
  } };
  vi.mocked(rebuildPage).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Writer unavailable")).mockResolvedValue(undefined);
  const dispatches: Dispatch[] = ["one", "two"].map((pageId) => ({ pageId, role: "planner", heading: null, note: "Fill gaps", reason: "Missing knowledge", claimIds: ["claim"] }));
  const deps = { db, client: {} as AdminSupabase, settings: { apiKey: "test" }, writer: new FakeSectionWriter() };
  const run = (items: Dispatch[]) => uploadExecution.run({ eventId: "upload", token: "owner", db }, () => runDispatches(deps, items));
  expect((await run(dispatches)).map((outcome) => outcome.status)).toEqual(["done", "failed"]);
  expect((await run(jsonb(dispatches) as Dispatch[])).map((outcome) => outcome.status)).toEqual(["done", "done"]);
  expect(submits).toBe(2);
  expect(discoverArticleUpdates).toHaveBeenCalledTimes(2);
  expect(rebuildPage).toHaveBeenCalledTimes(3);
});
