import { expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";

it("queues empty and unfinished articles for coverage repair, including replacement sections", async () => {
  const { pg, db } = await portablePostgres();
  try {
    const page = (await pg.query<{ id: string }>("insert into pages(title,slug) values('Incomplete article','incomplete-article') returning id")).rows[0]!.id;
    const old = (await pg.query<{ id: string }>("insert into sections(page_id,title,position,mode,status) values($1,'Old section',0,'generated','stale') returning id", [page])).rows[0]!.id;
    const queue = () => db.call<string[]>("pages_needing_editorial_review", { p_section_ids: [old] });
    expect(await queue()).toEqual([page]);
    await pg.query("update sections set retired_at=now() where id=$1", [old]);
    await pg.query("insert into sections(page_id,title,position,mode,status) values($1,'Replacement',1,'generated','stale')", [page]);
    expect(await queue()).toEqual([page]);
    await pg.query("update pages set retired_at=now() where id=$1", [page]);
    expect(await queue()).toEqual([]);
  } finally { await pg.close(); }
});

it("skips unchanged reviewed articles but requeues them if a section becomes unfinished", async () => {
  const { pg, db } = await portablePostgres();
  try {
    const page = (await pg.query<{ id: string }>("insert into pages(title,slug) values('Reviewed article','reviewed-article') returning id")).rows[0]!.id;
    const section = (await pg.query<{ id: string }>("insert into sections(page_id,title,position,mode,status) values($1,'Notes',0,'manual','current') returning id", [page])).rows[0]!.id;
    await pg.query("insert into page_review_runs(page_id,summary,edits,exceptions,snapshot_hash) values($1,'Reviewed',0,0,public.page_review_content_hash($1))", [page]);
    const queue = () => db.call<string[]>("pages_needing_editorial_review", { p_section_ids: [section] });
    expect(await queue()).toEqual([]);
    await pg.query("update sections set status='stale' where id=$1", [section]);
    expect(await queue()).toEqual([page]);
  } finally { await pg.close(); }
});
