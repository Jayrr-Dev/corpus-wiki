import { expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";

it("counts distinct source-backed sections and excludes retired sections and pages", async () => {
  const { pg } = await portablePostgres();
  try {
    const source = (await pg.query<{ source_id: string }>("select source_id from source_usage where section_count>0 limit 1")).rows[0]!.source_id;
    const baseline = (await pg.query<{ section_count: number }>("select section_count from source_usage where source_id=$1", [source])).rows[0]!.section_count;
    const inputs = (await pg.query<{ unit_id: string; revision_id: string }>("select u.id unit_id,u.current_revision_id revision_id from source_units su join units u on u.id=su.unit_id where su.source_id=$1 and u.retired_at is null limit 2", [source])).rows;
    expect(inputs.length).toBeGreaterThan(1);
    const page = (await pg.query<{ id: string }>("insert into pages(title,slug) values('Source section count','source-section-count') returning id")).rows[0]!.id;
    const section = (await pg.query<{ id: string }>("insert into sections(page_id,title,position,mode,query) values($1,'Two claims, one section',0,'generated','{}') returning id", [page])).rows[0]!.id;
    for (const input of inputs) await pg.query("insert into section_inputs(section_id,unit_id,revision_id) values($1,$2,$3)", [section, input.unit_id, input.revision_id]);
    const count = async () => (await pg.query<{ section_count: number }>("select section_count from source_usage where source_id=$1", [source])).rows[0]!.section_count;
    expect(await count()).toBe(baseline + 1);
    await pg.query("update sections set retired_at=now() where id=$1", [section]);
    expect(await count()).toBe(baseline);
    await pg.query("update sections set retired_at=null where id=$1", [section]);
    await pg.query("update pages set retired_at=now() where id=$1", [page]);
    expect(await count()).toBe(baseline);
  } finally { await pg.close(); }
});
