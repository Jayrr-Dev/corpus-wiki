import { expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import type { ArticleStructureMemory } from "@/lib/living-page/articleStructureMemory";

it("versions article structures, separates drafts from applied plans, and isolates spaces", async () => {
  const { pg, db } = await portablePostgres();
  try {
    const page = (await pg.query<{ id: string }>("insert into pages(title,slug) values('Structure memory','structure-memory') returning id")).rows[0]!.id;
    const save = (key: string) => db.call<string>("save_article_structure_plan", { p_page_id: page, p_plan_key: key,
      p_structure: [{ title: "Overview", unitIds: [], position: 0 }], p_changes: { keepSectionIds: [], replaceSectionIds: [] }, p_rationale: "Introduce the subject before its examples.", p_model_version: "test" });
    const read = () => db.call<ArticleStructureMemory>("read_article_structure", { p_page_id: page });
    const first = await save("first");
    expect(await save("first")).toBe(first);
    expect(await read()).toMatchObject({ applied: null, planned: { id: first, status: "planned" } });
    await db.call("finish_article_structure_plan", { p_plan_id: first, p_status: "applied" });
    const section = (await pg.query<{ id: string }>("insert into sections(page_id,title,mode,position,query) values($1,'Live topic','generated',0,'{}') returning id", [page])).rows[0]!.id;
    expect(await read()).toMatchObject({ current: [{ sectionId: section, title: "Live topic" }], applied: { outOfDate: true } });
    await db.call("finish_article_structure_plan", { p_plan_id: first, p_status: "applied" });
    expect((await read()).applied?.outOfDate).toBe(false);
    await pg.query("update sections set title='Updated topic' where id=$1", [section]);
    expect(await read()).toMatchObject({ current: [{ title: "Updated topic" }], applied: { outOfDate: true } });
    const unit = (await pg.query<{ id: string }>("select id from units where retired_at is null limit 1")).rows[0]!.id;
    await pg.query("update sections set query=jsonb_build_object('unitIds',jsonb_build_array($1::text)) where id=$2", [unit, section]);
    await db.call("finish_article_structure_plan", { p_plan_id: first, p_status: "applied" });
    expect((await read()).applied?.outOfDate).toBe(false);
    await pg.query("update units set retired_at=now() where id=$1", [unit]);
    expect(await read()).toMatchObject({ current: [{ title: "Updated topic", unitIds: [] }], applied: { outOfDate: true } });
    const failed = await save("next");
    expect(await read()).toMatchObject({ applied: { id: first }, planned: { id: failed } });
    await db.call("finish_article_structure_plan", { p_plan_id: failed, p_status: "failed" });
    expect(await read()).toMatchObject({ applied: { id: first }, planned: null });
    const retry = await save("next");
    expect(retry).not.toBe(failed);
    await db.call("finish_article_structure_plan", { p_plan_id: retry, p_status: "applied" });
    expect(await read()).toMatchObject({ applied: { id: retry }, planned: null });
    expect((await pg.query("select count(*)::int total from article_structure_plans where page_id=$1", [page])).rows[0]).toEqual({ total: 3 });
    const stale = await save("stale-draft");
    const current = await save("newer-plan");
    await db.call("finish_article_structure_plan", { p_plan_id: current, p_status: "applied" });
    expect((await pg.query("select status from article_structure_plans where id=$1", [stale])).rows[0]).toEqual({ status: "superseded" });

    const owner = "10000000-0000-4000-8000-999999999999";
    await pg.query("insert into auth.users(id,email) values($1,'structure@example.test')", [owner]);
    const space = (await pg.query<{ id: string }>("insert into spaces(name,owner_id) values('Other space',$1) returning id", [owner])).rows[0]!.id;
    await pg.query("select set_config('request.headers',$1,false)", [JSON.stringify({ "x-space-id": space, "x-person-id": owner, "x-via": "script" })]);
    expect(await read()).toEqual({ current: [], applied: null, planned: null });
    await expect(save("foreign-plan")).rejects.toThrow("unavailable");
  } finally { await pg.close(); }
});
