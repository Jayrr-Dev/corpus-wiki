import { beforeEach, expect, it, vi } from "vitest";
import type { DbRpc, RpcArgs } from "@/lib/db/rpc";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { maintainPageTree } from "./maintainPageTree";
import { runCuratorPass } from "./runCurator";
import { refreshOrganizationOverviews } from "@/lib/living-page/refreshOrganizationOverviews";
import { runDispatches } from "./dispatch";
import { uploadExecution } from "@/lib/ingest/workflowContext";
import type { OverviewOutcome } from "@/lib/living-page/refreshOrganizationOverviews";

vi.mock("./runCurator", () => ({ runCuratorPass: vi.fn(async () => ({ mergedSectionIds: [], affectedPageIds: ["related"], dispatches: [] })), writeMergedSections: vi.fn() }));
vi.mock("./dispatch", () => ({ runDispatches: vi.fn(async () => []) }));
vi.mock("@/lib/living-page/refreshOrganizationOverviews", () => ({ refreshOrganizationOverviews: vi.fn(async () => []) }));
beforeEach(() => vi.clearAllMocks());
const call = vi.fn(async (name: string) => name === "list_affected_sections" ? [{ pageId: "changed", sectionId: "section" }] : ["claim"]);
const deps = { db: { call: call as DbRpc["call"] }, settings: { apiKey: "test" }, client: {} as AdminSupabase };

it("scopes upload curation and overview repair without forcing unrelated overviews to rebuild", async () => {
  await maintainPageTree(deps, "upload");
  expect(runCuratorPass).toHaveBeenCalledWith(deps.db, undefined, { scope: { pageIds: ["changed"], unitIds: ["claim"] } });
  expect(refreshOrganizationOverviews).toHaveBeenCalledWith(deps, "upload", { affectedPageIds: ["changed", "related"] });
});

it("preserves a full-tree manual curator run", async () => {
  await maintainPageTree(deps, null);
  expect(call).not.toHaveBeenCalled();
  expect(runCuratorPass).toHaveBeenCalledWith(deps.db, undefined, { scope: undefined });
  expect(refreshOrganizationOverviews).toHaveBeenCalledWith(deps, null, {});
});

it("keeps failed upload upkeep retryable and reuses the completed structural pass", async () => {
  const saved = new Map<string, unknown>();
  const db: DbRpc = { async call<T>(name: string, args: RpcArgs = {}) {
    const key = String(args.p_key);
    if (name === "start_upload_step") return { done: saved.has(key), output: saved.get(key) } as T;
    if (name === "finish_upload_step") { if (!args.p_error) saved.set(key, args.p_output); return null as T; }
    return await call(name) as T;
  } };
  vi.mocked(refreshOrganizationOverviews).mockResolvedValueOnce([{ status: "failed", detail: "Overview writer unavailable" } as OverviewOutcome]).mockResolvedValueOnce([]);
  const run = () => uploadExecution.run({ eventId: "upload", token: "owner", db }, () => maintainPageTree({ ...deps, db }, "upload"));
  await expect(run()).rejects.toThrow("Overview writer unavailable");
  await expect(run()).resolves.toMatchObject({ overviews: [] });
  expect(runCuratorPass).toHaveBeenCalledTimes(1);
  expect(refreshOrganizationOverviews).toHaveBeenCalledTimes(2);
});

it("reports failed dispatches as unfinished upload work", async () => {
  vi.mocked(runDispatches).mockResolvedValueOnce([{ role: "planner", pageId: "page", heading: null, note: "", reason: "", claimIds: [], status: "failed", detail: "Planner unavailable" }]);
  await expect(maintainPageTree(deps, "upload")).rejects.toThrow("Planner unavailable");
});
