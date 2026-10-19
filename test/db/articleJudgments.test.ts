import { expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";

it("saves one current judgment per claim and stage, and isolates spaces", async () => {
  const { pg, db } = await portablePostgres();
  try {
    const page = (await pg.query<{ id: string }>("insert into pages(title,slug) values('Judged','judged') returning id")).rows[0]!.id;
    const revision = "10000000-0000-4000-8000-000000000123";
    const save = (decision: string, stage = "discovery") => db.call<number>("save_article_judgments", { p_page_id: page, p_stage: stage,
      p_judgments: [{ subject: "unit-a", revisionId: revision, basis: "b1", decision, reason: "Per-type detail." }, { subject: "unit-a", revisionId: revision, basis: "b1", decision, reason: "Repeated." }] });
    expect(await save("outside_scope")).toBe(1);
    await save("already_covered");
    await save("in_scope", "scope");
    expect(await db.call("read_article_judgments", { p_page_id: page })).toEqual([
      { stage: "discovery", subject: "unit-a", revisionId: revision, basis: "b1", decision: "already_covered", reason: "Per-type detail." },
      { stage: "scope", subject: "unit-a", revisionId: revision, basis: "b1", decision: "in_scope", reason: "Per-type detail." },
    ]);
    await expect(save("outside_scope", "invented")).rejects.toThrow();

    const owner = "10000000-0000-4000-8000-999999999998";
    await pg.query("insert into auth.users(id,email) values($1,'judgments@example.test')", [owner]);
    const space = (await pg.query<{ id: string }>("insert into spaces(name,owner_id) values('Other space',$1) returning id", [owner])).rows[0]!.id;
    await pg.query("select set_config('request.headers',$1,false)", [JSON.stringify({ "x-space-id": space, "x-person-id": owner, "x-via": "script" })]);
    expect(await db.call("read_article_judgments", { p_page_id: page })).toEqual([]);
    await expect(save("outside_scope")).rejects.toThrow("unavailable");
  } finally { await pg.close(); }
});
