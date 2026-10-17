import { beforeEach, expect, it, vi } from "vitest";
import { overviewInput, refreshOrganizationOverviews } from "./refreshOrganizationOverviews";
import * as articlePlanner from "./articlePlanner";
import type { CuratorSnapshot } from "@/lib/curator/curate";
import { rebuildPage } from "./index";
import { chatJson } from "@/lib/ai/chat";
import { uploadExecution } from "@/lib/ingest/workflowContext";
import type { DbRpc, RpcArgs } from "@/lib/db/rpc";
import type { AdminSupabase } from "@/lib/supabase/admin";
import type { CuratorPage } from "@/lib/curator/score";
import { FakeSectionWriter } from "./writers/fake";

vi.mock("./index", () => ({ rebuildPage: vi.fn() }));
vi.mock("@/lib/ai/chat", () => ({ ANSWER_TOKEN_BUDGET: 32_000, chatJson: vi.fn(), addUsage: (a: { tokensIn: number; tokensOut: number }, b: { tokensIn: number; tokensOut: number }) => ({ tokensIn: a.tokensIn + b.tokensIn, tokensOut: a.tokensOut + b.tokensOut }) }));
beforeEach(() => vi.resetAllMocks());

it("distinguishes an organization with no claims from an unavailable evidence read", async () => {
  const client = { from: () => {
    const query = { select: () => query, in: () => query, is: () => query, ilike: () => query,
      then: (resolve: (result: unknown) => unknown) => Promise.resolve(resolve({ data: [{ id: "entity", type: "company", key: "company", name: "Company" }], error: null })) };
    return query;
  } } as unknown as AdminSupabase;
  const snapshot = { pages: [{ id: "page", title: "Company", organization: true, claimIds: [], parentId: null }] } as unknown as CuratorSnapshot;
  const health = { pageId: "page", title: "Company", claims: 0, childClaims: 0, childShare: 0, needsOverview: true };
  const load = vi.spyOn(articlePlanner, "loadArticleKnowledge").mockRejectedValueOnce(new Error("Evidence database unavailable"));
  await expect(overviewInput(client, snapshot, health)).rejects.toThrow("Evidence database unavailable");
  load.mockRejectedValueOnce(new articlePlanner.NoArticleClaimsError());
  await expect(overviewInput(client, snapshot, health)).resolves.toMatchObject({ own: [], borrowed: [] });
  load.mockRestore();
});

it("resumes an overview's failed writer even after its committed outline stops qualifying for repair", async () => {
  const page = (id: string, parentId: string | null, claimIds: string[]): CuratorPage => ({ id, parentId, claimIds, title: id, articleType: "concept", scope: "A topic", contextName: null, organization: false, lines: 0, sections: [] });
  const pages = [page("parent", null, []), page("child", "parent", ["claim"])];
  const steps = new Map<string, unknown>();
  const writes = new Map<string, unknown>();
  let submits = 0;
  const db: DbRpc = { async call<T>(name: string, args: RpcArgs = {}) {
    const key = String(args.p_key);
    if (name === "curator_snapshot") return structuredClone({ pages }) as T;
    if (name === "start_upload_step") return { done: steps.has(key), output: steps.get(key) } as T;
    if (name === "finish_upload_step") { if (!args.p_error) steps.set(key, structuredClone(args.p_output)); return null as T; }
    if (name === "upload_workflow_write") {
      if (writes.has(key)) return writes.get(key) as T;
      const result = args.p_function === "submit_change_set" ? (++submits, { changeSetId: "outline" }) : { status: "applied", applied: 1, rejected: 0 };
      if (args.p_function === "commit_change_set") pages[0]!.sections = ["Overview"];
      writes.set(key, result);
      return result as T;
    }
    throw new Error(`Unexpected call ${name}`);
  } };
  const client = { from: (table: string) => {
    const rows = table === "units" ? [{ id: "claim", current_revision_id: "revision", kind: "fact", epistemic_status: "supported" }]
      : table === "revisions" ? [{ id: "revision", content: "The program teaches safe work practices." }] : [];
    const query = { select: () => query, eq: () => query, in: () => query, is: () => query, order: () => query,
      then: (resolve: (result: unknown) => unknown) => Promise.resolve(resolve({ data: rows, error: null })) };
    return query;
  } } as unknown as AdminSupabase;
  vi.mocked(chatJson).mockResolvedValue({ value: { introduction: ["K1"], sections: [] }, model: "test", tokensIn: 1, tokensOut: 1 });
  vi.mocked(rebuildPage).mockRejectedValueOnce(new Error("Writer unavailable")).mockResolvedValue(undefined);
  const deps = { db, client, settings: { apiKey: "test" }, writer: new FakeSectionWriter() };
  const run = () => uploadExecution.run({ eventId: "event", token: "owner", db }, () => refreshOrganizationOverviews(deps, "event"));
  expect(await run()).toMatchObject([{ status: "failed", detail: "Writer unavailable" }]);
  expect(await run()).toMatchObject([{ status: "applied" }]);
  expect(await run()).toMatchObject([{ status: "applied" }]);
  expect(rebuildPage).toHaveBeenCalledTimes(2);
  expect(chatJson).toHaveBeenCalledTimes(1);
  expect(submits).toBe(1);
});

