import { expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";

it("retrieves topic evidence beyond the original outline and keeps empty sections unfinished", async () => {
  const { pg, db } = await portablePostgres();
  try {
    await pg.exec(`begin; set constraints all deferred;
      insert into shift_events(id,cause,actor,status) values('11000000-0000-4000-8000-000000000001','edit','ai','applied');
      insert into units(id,kind,epistemic_status,current_revision_id,valid_from) values
        ('11000000-0000-4000-8000-000000000002','fact','established','11000000-0000-4000-8000-000000000003',current_date);
      insert into revisions(id,unit_id,content,event_id,author,source_date) values
        ('11000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-000000000002','The Reformer has a strong inner critic.','11000000-0000-4000-8000-000000000001','ai',current_date);
      commit;`);
    expect(await db.call("article_knowledge_candidates", { p_title: "Enneagram Type One (Reformer)" })).toContain("11000000-0000-4000-8000-000000000002");
    expect(await db.call("article_knowledge_candidates", { p_title: "Unrelated ocean currents" })).not.toContain("11000000-0000-4000-8000-000000000002");
    const page = (await pg.query<{ id: string }>("insert into pages(title,slug) values('Coverage','coverage') returning id")).rows[0]!.id;
    const section = (await pg.query<{ id: string }>(`insert into sections(page_id,title,position,mode,status,query) values($1,'Motivations',0,'generated','stale','{"unitIds":["11000000-0000-4000-8000-000000000002"]}') returning id`, [page])).rows[0]!.id;
    await db.call("finish_section_build", { p_section_id: section, p_event_id: null, p_model_version: "test", p_changed: false });
    expect((await pg.query("select status,built_at from sections where id=$1", [section])).rows[0]).toMatchObject({ status: "stale", built_at: null });
    await pg.query("update sections set query='{}',status='current' where id=$1", [section]);
    expect((await pg.query("select status from sections where id=$1", [section])).rows[0]).toMatchObject({ status: "stale" });
  } finally { await pg.close(); }
});
