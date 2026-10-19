import { expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";

it("reports whether a page's exact content was already reviewed, partially or completely", async () => {
  const { pg, db } = await portablePostgres();
  try {
    const page = (await pg.query<{ id: string }>("insert into pages(title,slug) values('Reviewed','reviewed') returning id")).rows[0]!.id;
    await pg.query("insert into sections(page_id,title,position,mode,status,query) values($1,'Topic',0,'manual','current','{}')", [page]);
    await pg.query("update sections set status='current' where page_id=$1", [page]);
    const state = () => db.call("page_review_state", { p_page_id: page });
    expect(await state()).toEqual({ current: false, partialRuns: 0, unfinishedSections: 0 });
    const hash = await db.call<string>("page_review_content_hash", { p_page_id: page });
    const run = (snapshot: string) => pg.query("insert into page_review_runs(page_id,summary,edits,exceptions,snapshot_hash) values($1,'Reviewed',0,0,$2)", [page, snapshot]);
    await run(`partial:${hash}`);
    await run(`partial:${hash}`);
    expect(await state()).toEqual({ current: false, partialRuns: 2, unfinishedSections: 0 });
    await run(hash);
    expect(await state()).toMatchObject({ current: true });
    await pg.query("update sections set title='Renamed topic', status='stale' where page_id=$1", [page]);
    expect(await state()).toEqual({ current: false, partialRuns: 0, unfinishedSections: 1 });
  } finally { await pg.close(); }
});
