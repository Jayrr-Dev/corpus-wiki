import { expect, it, vi } from "vitest";
import { forceCreateSection } from "./forceCreateSection";
import { rebuildSection } from "./index";
import { uploadExecution } from "@/lib/ingest/workflowContext";
import type { DbRpc, RpcArgs } from "@/lib/db/rpc";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { FakeSectionWriter } from "./writers/fake";

vi.mock("./index", () => ({ rebuildSection: vi.fn() }));

it("resumes writing the replacement section after a writer failure without reading the retired original", async () => {
  const steps = new Map<string, unknown>();
  let retired = false;
  let submits = 0;
  let originalReads = 0;
  const db: DbRpc = { async call<T>(name: string, args: RpcArgs = {}) {
    const key = String(args.p_key);
    if (name === "start_upload_step") return { done: steps.has(key), output: steps.get(key) } as T;
    if (name === "finish_upload_step") { if (!args.p_error) steps.set(key, args.p_output); return null as T; }
    if (name === "read_section_state") return { lines: [], units: [{ unitId: "claim", content: "Supported knowledge" }] } as T;
    if (name === "upload_workflow_write") {
      if (args.p_function === "submit_change_set") { submits++; return { changeSetId: "replacement" } as T; }
      retired = true; return { status: "applied", applied: 2, rejected: 0 } as T;
    }
    throw new Error(`Unexpected call ${name}`);
  } };
  const section = { id: "old", page_id: "page", title: "Knowledge", position: 1, query: { unitIds: ["claim"], article: true }, mode: "generated" };
  const client = { from: (table: string) => {
    const query = { select: () => query, eq: () => query, is: () => query,
      single: async () => {
        if (table === "sections") { originalReads++; if (retired) return { data: null, error: { message: "Original retired" } }; }
        return { data: table === "sections" ? section : table === "pages" ? { id: "page", title: "Article", entity_id: null } : { target_id: "new" }, error: null };
      }, then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: [section], error: null })) };
    return query;
  } } as unknown as AdminSupabase;
  vi.mocked(rebuildSection).mockRejectedValueOnce(new Error("Writer unavailable")).mockResolvedValue({ sectionId: "new", changeNoteId: null });
  const deps = { db, client, settings: { apiKey: "test" }, writer: new FakeSectionWriter(), webSearchKey: null };
  const run = () => uploadExecution.run({ eventId: "upload", token: "owner", db }, () => forceCreateSection(deps, "old", "", false));
  await expect(run()).rejects.toThrow("Writer unavailable");
  await expect(run()).resolves.toMatchObject({ sectionId: "new" });
  expect(submits).toBe(1);
  expect(originalReads).toBe(1);
  expect(rebuildSection).toHaveBeenLastCalledWith(db, deps.writer, "new", null);
});
