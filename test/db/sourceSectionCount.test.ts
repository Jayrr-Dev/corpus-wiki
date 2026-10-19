import { expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";

it("counts distinct source-backed sections and used units, excluding retired sections and pages", async () => {
  const { pg } = await portablePostgres();
  try {
    const source = (await pg.query<{ source_id: string }>("select source_id from source_usage where section_count>0 limit 1")).rows[0]!.source_id;
    const count = async () => (await pg.query<{ section_count: number; used_unit_count: number }>("select section_count, used_unit_count from source_usage where source_id=$1", [source])).rows[0]!;
    const baseline = await count();
    const inputs = (await pg.query<{ unit_id: string; revision_id: string }>("select u.id unit_id,u.current_revision_id revision_id from source_units su join units u on u.id=su.unit_id where su.source_id=$1 and u.retired_at is null limit 2", [source])).rows;
    expect(inputs.length).toBeGreaterThan(1);
    const alreadyUsed = Number((await pg.query<{ n: number }>(`select count(*)::int n from source_units su
      where su.source_id=$1 and su.unit_id=any($2::uuid[]) and exists (
        select 1 from section_inputs si
        join sections sec on sec.id=si.section_id
        join pages pg on pg.id=sec.page_id
        where si.unit_id=su.unit_id and sec.retired_at is null and pg.retired_at is null
      )`, [source, inputs.map((input) => input.unit_id)])).rows[0]!.n);
    const page = (await pg.query<{ id: string }>("insert into pages(title,slug) values('Source section count','source-section-count') returning id")).rows[0]!.id;
    const section = (await pg.query<{ id: string }>("insert into sections(page_id,title,position,mode,query) values($1,'Two claims, one section',0,'generated','{}') returning id", [page])).rows[0]!.id;
    for (const input of inputs) await pg.query("insert into section_inputs(section_id,unit_id,revision_id) values($1,$2,$3)", [section, input.unit_id, input.revision_id]);
    expect(await count()).toEqual({ section_count: baseline.section_count + 1, used_unit_count: baseline.used_unit_count + inputs.length - alreadyUsed });
    await pg.query("update sections set retired_at=now() where id=$1", [section]);
    expect(await count()).toEqual(baseline);
    await pg.query("update sections set retired_at=null where id=$1", [section]);
    await pg.query("update pages set retired_at=now() where id=$1", [page]);
    expect(await count()).toEqual(baseline);
  } finally { await pg.close(); }
});
