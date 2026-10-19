import { it, expect } from "vitest";
import { portablePostgres } from "./portablePostgres";
import type { ComposerSnapshot } from "@/lib/composer/types";

it("saves reversible illustration versions, rejects stale saves and preserves drawings through updates", async () => {
  const { pg, db } = await portablePostgres();
  try {
    const page = (await pg.query<{ id: string }>("insert into pages(title,slug) values ('Illustration test','composer-live-test') returning id")).rows[0]!.id;
    const section = (await pg.query<{ id: string }>("insert into sections(page_id,title,mode,query,position) values($1,'Overview','generated','{}',0) returning id", [page])).rows[0]!.id;
    // Circular line/revision FKs are deferred by the schema.
    await pg.exec(`begin; set constraints all deferred;
      insert into lines(id,section_id,position,current_revision_id) values('10000000-0000-4000-8000-000000000001','${section}',0,'10000000-0000-4000-8000-000000000002');
      insert into line_revisions(id,line_id,content,unit_revision_ids,author,event_id) values('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Power above communications','{}','ai',(select id from shift_events limit 1)); commit;`);
    const snapshot = await db.call<ComposerSnapshot>("composer_page_snapshot", { p_page_id: page });
    const composition = { figures: [{ after: snapshot.paragraphs[0]!.id, evidence: [snapshot.paragraphs[0]!.id], svg: '<svg/>', caption: 'Illustration', alt: 'Description', learningGoal: 'Vertical arrangement' }], omitted: '' };
    const save = () => db.call<string>("save_composer_run", { p_page_id: page, p_snapshot: snapshot, p_composition: composition, p_review: { total: 18 }, p_model: 'test' });
    const run = await save();
    // Large independently stored JSON fields must survive read serialization.
    const largeReview = { total: 18, notes: Array.from({ length: 400 }, (_, i) => `Review detail ${i}: ${i * 7919}`).join("\n") };
    await pg.query("update composer_runs set review=$1::jsonb where id=$2", [JSON.stringify(largeReview), run]);
    expect(await db.call("read_composer_run", { p_page_id: page })).toMatchObject({
      id: run, page_id: page, snapshot, composition, review: largeReview, model: "test", active: true,
    });
    expect(await db.call("read_composer_run", { p_page_id: "00000000-0000-4000-8000-000000000000" })).toBeNull();
    const generated = (await pg.query<{ id: string; source_id: null; passage_ids: string[] }>("select id,source_id,passage_ids from assets where origin='generated'")).rows;
    expect(generated).toHaveLength(1);
    expect(generated[0]).toMatchObject({ source_id: null, passage_ids: [] });
    const placement = { assetId: generated[0]!.id, pageId: page, title: "Illustration test", slug: "composer-live-test" };
    expect(await db.call("asset_article_usage")).toEqual([placement]);
    expect(await db.call("asset_app_usage")).toEqual([{ assetId: generated[0]!.id, kind: "article", title: placement.title, href: `/p/${placement.slug}` }]);
    expect(await db.call("read_generated_asset", { p_asset_id: generated[0]!.id })).toMatchObject({ svg: "<svg/>" });
    expect(await db.call("read_composer_run", { p_page_id: page })).toMatchObject({ id: run });
    await db.call("select_composer_run", { p_page_id: page, p_run_id: null });
    expect(await db.call("asset_article_usage")).toEqual([]);
    expect(await db.call("read_composer_run", { p_page_id: page })).toBeNull();
    expect(await db.call("read_generated_asset", { p_asset_id: generated[0]!.id })).toMatchObject({ svg: "<svg/>" });
    await db.call("select_composer_run", { p_page_id: page, p_run_id: run });
    expect(await db.call("read_composer_run", { p_page_id: page })).toMatchObject({ id: run });
    const second = await save();
    expect((await pg.query("select id from assets where origin='generated'")).rows).toHaveLength(1);
    expect(second).not.toBe(run);
    expect((await pg.query<{ n: number }>("select count(*)::int n from composer_runs where active")).rows[0]!.n).toBe(1);
    await expect(db.call("save_composer_run_checked", { p_page_id: page, p_snapshot: snapshot, p_composition: composition, p_review: {}, p_model: "test", p_expected_run_id: run })).rejects.toThrow("Illustrations changed");
    expect(await db.call("read_composer_run", { p_page_id: page })).toMatchObject({ id: second });
    const reused = { figures: [{ ...composition.figures[0], svg: "", assetId: generated[0]!.id }], omitted: "Reused library image" };
    await db.call("save_composer_run_checked", { p_page_id: page, p_snapshot: snapshot, p_composition: reused, p_review: { total: 18 }, p_model: "test", p_expected_run_id: second });
    expect((await pg.query("select id from assets where origin='generated'")).rows).toHaveLength(1);
    expect(await db.call("read_composer_run", { p_page_id: page })).toMatchObject({ composition: { figures: [{ assetId: generated[0]!.id }] } });
    expect(await db.call("asset_article_usage")).toEqual([placement]);
    await pg.query("update assets set deleted_at=now() where id=$1", [generated[0]!.id]);
    expect(await db.call("asset_article_usage")).toEqual([placement]);
    await expect(db.call("save_composer_run", { p_page_id: page, p_snapshot: snapshot, p_composition: reused, p_review: {}, p_model: "test" })).rejects.toThrow("Invalid Composer figure");
    await pg.query("update assets set deleted_at=null where id=$1", [generated[0]!.id]);
    await pg.exec(`begin; set constraints all deferred;
      insert into line_revisions(id,line_id,content,unit_revision_ids,author,event_id) select '10000000-0000-4000-8000-000000000003',line_id,'Changed article',unit_revision_ids,author,event_id from line_revisions where id='${snapshot.paragraphs[0]!.revisionId}';
      update lines set current_revision_id='10000000-0000-4000-8000-000000000003' where id='${snapshot.paragraphs[0]!.id}'; commit;`);
    expect(await db.call("read_composer_run", { p_page_id: page })).toMatchObject({ composition: { figures: [] } });
    expect(await db.call("asset_article_usage")).toEqual([]);
    await expect(save()).rejects.toThrow('article changed');
    await expect(db.call("select_composer_run", { p_page_id: page, p_run_id: run })).rejects.toThrow('no longer matches');
    await pg.exec('set role authenticated');
    expect((await pg.query("select id from assets where origin='generated'")).rows).toHaveLength(1);
    await expect(pg.query("select * from generated_asset_content")).rejects.toThrow('permission denied');
    await expect(pg.query('select * from composer_runs')).rejects.toThrow('permission denied');
  } finally { await pg.close(); }
});

it("finds source images in knowledge previews and article evidence without Composer", async () => {
  const { pg, db } = await portablePostgres();
  try {
    const source = (await pg.query<{ id: string }>("select id from sources limit 1")).rows[0]!.id;
    await pg.query("update sources set mime_type='image/png' where id=$1", [source]);
    const asset = (await pg.query<{ id: string }>("insert into assets(source_id,kind,storage_path,mime_type) values($1,'image','test.png','image/png') returning id", [source])).rows[0]!.id;
    const revision = (await pg.query<{ id: string }>("select r.id from revisions r join passages pa on pa.id=any(r.passage_ids) where pa.source_id=$1 limit 1", [source])).rows[0]!.id;
    const page = (await pg.query<{ id: string }>("insert into pages(title,slug) values('Evidence image','evidence-image') returning id")).rows[0]!.id;
    const section = (await pg.query<{ id: string }>("insert into sections(page_id,title,mode,query,position) values($1,'Overview','generated','{}',0) returning id", [page])).rows[0]!.id;
    await pg.exec(`begin; set constraints all deferred;
      insert into lines(id,section_id,position,current_revision_id) values('10000000-0000-4000-8000-000000000011','${section}',0,'10000000-0000-4000-8000-000000000012');
      insert into line_revisions(id,line_id,content,unit_revision_ids,author,event_id) values('10000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000011','Evidence','{${revision}}','ai',(select id from shift_events limit 1)); commit;`);
    const placements = await db.call<{ assetId: string; kind: string; href: string }[]>("asset_app_usage");
    const uses = placements.filter((p) => p.assetId === asset);
    expect(uses).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "source", href: `/sources/${source}` }),
      expect.objectContaining({ kind: "knowledge" }),
      expect.objectContaining({ kind: "article", href: "/p/evidence-image" }),
    ]));
    expect(new Set(uses.map((p) => p.href)).size).toBe(uses.length);
    await pg.query("update sections set retired_at=now() where id=$1", [section]);
    expect(await db.call("asset_app_usage")).not.toEqual(expect.arrayContaining([expect.objectContaining({ href: "/p/evidence-image" })]));
  } finally { await pg.close(); }
});
