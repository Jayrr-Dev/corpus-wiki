import { expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";

it("caches visible lines and their newest cited revision per claim, removing obsolete inputs", async () => {
  const { pg } = await portablePostgres();
  const [event, unit, old, latest, page, section, lineA, revisionA, lineB, revisionB] = Array.from({ length: 10 }, () => crypto.randomUUID());
  try {
    await pg.exec("begin;set constraints all deferred");
    await pg.query("insert into shift_events(id,cause,actor,status) values($1,'edit','ai','applied')", [event]);
    await pg.query("insert into units(id,kind,epistemic_status,current_revision_id,valid_from) values($1,'fact','established',$2,current_date)", [unit, latest]);
    await pg.query("insert into revisions(id,unit_id,content,event_id,author,source_date,created_at) values($1,$3,'Old',$4,'ai',current_date,'2026-01-01'),($2,$3,'Latest',$4,'ai',current_date,'2026-01-02')", [old, latest, unit, event]);
    await pg.query("insert into pages(id,title,slug) values($1,'Citation cache','citation-cache')", [page]);
    await pg.query("insert into sections(id,page_id,title,position,mode,status) values($1,$2,'Section',0,'generated','stale')", [section, page]);
    await pg.query("insert into lines(id,section_id,position,current_revision_id) values($1,$3,0,$4),($2,$3,1,$5)", [lineA, lineB, section, revisionA, revisionB]);
    await pg.query("insert into line_revisions(id,line_id,content,unit_revision_ids,event_id,author) values($1,$3,'First',$5,$7,'ai'),($2,$4,'Second',$6,$7,'ai')", [revisionA, revisionB, lineA, lineB, [old, old], [latest, old], event]);
    await pg.exec("commit");
    const refresh = () => pg.query("select change_control.refresh_section_cache($1)", [section]);
    const inputs = async () => (await pg.query("select unit_id,revision_id from section_inputs where section_id=$1", [section])).rows;
    await refresh();
    expect(await inputs()).toEqual([{ unit_id: unit, revision_id: latest }]);
    expect((await pg.query("select body from sections where id=$1", [section])).rows[0]).toEqual({ body: "First Second" });
    await pg.query("update lines set retired_at=now() where id=$1", [lineB]);
    await refresh();
    expect(await inputs()).toEqual([{ unit_id: unit, revision_id: old }]);
    await pg.query("update lines set retired_at=now() where id=$1", [lineA]);
    await refresh();
    expect(await inputs()).toEqual([]);
    expect((await pg.query("select body from sections where id=$1", [section])).rows[0]).toEqual({ body: "" });
  } finally { await pg.close(); }
});
