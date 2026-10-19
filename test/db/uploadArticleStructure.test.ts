import { expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import { splitIntoPassages } from "@/lib/ingest/passages";

it("dispatches article structure saves and finishes with replay and lease fencing", async () => {
  const { pg, db } = await portablePostgres();
  try {
    const { eventId } = await db.call<{ eventId: string }>("ingest_source", {
      p_title: "Structure upload", p_mime_type: "text/plain", p_source_date: "2026-10-18T00:00:00Z",
      p_hash: "structure-upload", p_storage_path: "test/structure.txt",
      p_passages: splitIntoPassages([{ text: "The subject has a documented history.", page: null }]),
    });
    const { token } = await db.call<{ token: string }>("claim_upload_workflow", { p_event_id: eventId });
    const page = (await pg.query<{ id: string }>("insert into pages(title,slug) values('Upload structure','upload-structure') returning id")).rows[0]!.id;
    const write = <T>(key: string, fn: string, args: Record<string, unknown>, lease = token) => db.call<T>("upload_workflow_write", {
      p_event_id: eventId, p_token: lease, p_key: key, p_function: fn, p_args: args,
    });
    const args = { p_page_id: page, p_plan_key: "reviewed", p_structure: [], p_changes: {}, p_rationale: "Reviewed structure", p_model_version: "test" };
    const plan = await write<string>("structure:save", "save_article_structure_plan", args);
    expect(await write("structure:save", "save_article_structure_plan", args)).toBe(plan);
    await write("structure:finish", "finish_article_structure_plan", { p_plan_id: plan, p_status: "applied", p_structure: [] });
    expect((await pg.query("select status from article_structure_plans where id=$1", [plan])).rows[0]).toEqual({ status: "applied" });
    expect((await pg.query("select count(*)::int total from article_structure_plans where page_id=$1", [page])).rows[0]).toEqual({ total: 1 });
    await expect(write("structure:save", "finish_article_structure_plan", { p_plan_id: plan, p_status: "applied" })).rejects.toThrow("key reused");
    await expect(write("unlisted", "read_article_structure", { p_page_id: page })).rejects.toThrow("Unsupported workflow write");
    await expect(write("wrong-owner", "save_article_structure_plan", args, "00000000-0000-4000-8000-000000000001")).rejects.toThrow();
    await db.call("cancel_upload_workflow", { p_event_id: eventId });
    await expect(write("cancelled", "save_article_structure_plan", args)).rejects.toThrow();
  } finally { await pg.close(); }
});
