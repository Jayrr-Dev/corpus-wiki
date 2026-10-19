import { expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";

it("counts knowledge used by articles and drops it when the article is retired", async () => {
  const { pg } = await portablePostgres();
  try {
    const usage = async () => (await pg.query<{ unit_count: number; used_unit_count: number }>("select unit_count, used_unit_count from knowledge_usage")).rows[0]!;
    const before = await usage();
    const inputs = (await pg.query<{ unit_id: string; revision_id: string }>("select u.id unit_id, u.current_revision_id revision_id from units u where u.retired_at is null and u.current_revision_id is not null limit 2")).rows;
    expect(inputs.length).toBeGreaterThan(1);
    const alreadyUsed = Number((await pg.query<{ n: number }>(`select count(*)::int n from units u
      where u.id = any($1::uuid[]) and exists (
        select 1 from section_inputs si
        join sections sec on sec.id = si.section_id
        join pages pg on pg.id = sec.page_id
        where si.unit_id = u.id and sec.retired_at is null and pg.retired_at is null and pg.article_type is not null
      )`, [inputs.map((input) => input.unit_id)])).rows[0]!.n);
    const page = (await pg.query<{ id: string }>("insert into pages(title, slug, article_type) values('Article knowledge', 'article-knowledge', 'concept') returning id")).rows[0]!.id;
    const section = (await pg.query<{ id: string }>("insert into sections(page_id, title, position, mode, query) values($1, 'Claims', 0, 'generated', '{}') returning id", [page])).rows[0]!.id;
    for (const input of inputs) await pg.query("insert into section_inputs(section_id, unit_id, revision_id) values($1, $2, $3)", [section, input.unit_id, input.revision_id]);
    expect(await usage()).toEqual({ unit_count: before.unit_count, used_unit_count: before.used_unit_count + inputs.length - alreadyUsed });
    const row = (await pg.query<{ unit_count: number }>("select unit_count from article_knowledge where page_id = $1", [page])).rows[0]!;
    expect(row.unit_count).toBe(inputs.length);
    const cited = (await pg.query<{ unit_id: string; unit_content: string }>("select unit_id, unit_content from section_knowledge where section_id = $1 order by unit_id", [section])).rows;
    expect(cited.map((item) => item.unit_id).sort()).toEqual(inputs.map((input) => input.unit_id).sort());
    expect(cited.every((item) => item.unit_content.length > 0)).toBe(true);
    await pg.query("update pages set retired_at = now() where id = $1", [page]);
    expect(await usage()).toEqual(before);
    expect((await pg.query("select 1 from article_knowledge where page_id = $1", [page])).rowCount).toBe(0);
    expect((await pg.query("select 1 from section_knowledge where section_id = $1", [section])).rowCount).toBe(0);
  } finally { await pg.close(); }
});
