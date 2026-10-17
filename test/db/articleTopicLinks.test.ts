import { expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import type { ArticleLink } from "@/lib/living-page/articleEvidence";

it("resolves concepts through live section claims and drops retired destinations", async () => {
  const store = await portablePostgres();
  try {
    const root = "00000000-0000-4000-8000-9a0000000001";
    const other = "f0000000-0000-4000-8000-000000000001";
    const entity = "f0000000-0000-4000-8000-000000000002";
    await store.pg.query("insert into pages(id,title,slug) values($1,'Safety','safety-test')", [other]);
    await store.pg.query("insert into entities(id,type,key,name,aliases) values($1,'concept','test-sds','Safety data sheets',array['SDS'])", [entity]);
    await store.pg.query("insert into unit_entities(unit_id,entity_id,role) select id,$1,'subject' from units where retired_at is null", [entity]);
    await store.pg.query(`insert into sections(page_id,position,title,query)
      select $1,0,'Chemical safety',jsonb_build_object('unitIds',jsonb_agg(id::text)) from units where retired_at is null`, [other]);
    const links = await store.db.call<ArticleLink[]>("article_topic_links", { p_page_id: root });
    expect(links.find((l) => l.label === "Safety data sheets")?.href).toMatch(/^\/p\/safety-test#section-/);
    expect(links.find((l) => l.label === "SDS")?.href).toBe(links.find((l) => l.label === "Safety data sheets")?.href);
    expect((await store.db.call<ArticleLink[]>("article_topic_links", { p_page_id: other })).some((l) => l.href.startsWith("/p/safety-test"))).toBe(false);
    await store.pg.query("update sections set retired_at=now() where page_id=$1", [other]);
    expect((await store.db.call<ArticleLink[]>("article_topic_links", { p_page_id: root })).some((l) => l.href.startsWith("/p/safety-test"))).toBe(false);
    // No current claim membership: a visible paragraph still names the concept.
    await store.pg.query("insert into sections(id,page_id,position,title,query) values('f0000000-0000-4000-8000-000000000003',$1,1,'Chemical information','{}')", [other]);
    await store.pg.exec(`begin;
      insert into lines(id,section_id,position,current_revision_id) values
        ('f0000000-0000-4000-8000-000000000004','f0000000-0000-4000-8000-000000000003',0,'f0000000-0000-4000-8000-000000000005');
      insert into line_revisions(id,line_id,content,event_id,author)
        select 'f0000000-0000-4000-8000-000000000005','f0000000-0000-4000-8000-000000000004','Workers consult the SDS.',id,'person' from shift_events limit 1;
      commit;`);
    expect((await store.db.call<ArticleLink[]>("article_topic_links", { p_page_id: root })).find((l) => l.label === "Safety data sheets")?.href)
      .toBe("/p/safety-test#section-f0000000-0000-4000-8000-000000000003");
    await store.pg.exec("update lines set retired_at=now() where id='f0000000-0000-4000-8000-000000000004'");
    expect((await store.db.call<ArticleLink[]>("article_topic_links", { p_page_id: root })).some((l) => l.href.startsWith("/p/safety-test"))).toBe(false);
  } finally { await store.pg.close(); }
}, 60000);
