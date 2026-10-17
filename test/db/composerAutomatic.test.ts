import { expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import type { ComposerClaim } from "@/lib/composer/jobs";

it("debounces article changes, shares manual/automatic ownership, remembers no-op and failed assessments, and keeps edits queued during a run", async () => {
  const { pg, db } = await portablePostgres();
  try {
    const page = (await pg.query<{ id: string }>("insert into pages(title,slug) values('Composer auto test','composer-auto-test') returning id")).rows[0]!.id;
    const section = (await pg.query<{ id: string }>("insert into sections(page_id,title,mode,query,position,status) values($1,'Overview','generated','{}',0,'current') returning id",[page])).rows[0]!.id;
    const revise = async (n: number) => pg.exec(`begin; set constraints all deferred;
      ${n === 1 ? `insert into lines(id,section_id,position,current_revision_id) values('10000000-0000-4000-8000-000000000001','${section}',0,'10000000-0000-4000-8000-00000000000${n+1}');` : ""}
      insert into line_revisions(id,line_id,content,unit_revision_ids,author,event_id) values('10000000-0000-4000-8000-00000000000${n+1}','10000000-0000-4000-8000-000000000001','Version ${n}','{}','ai',(select id from shift_events limit 1));
      update lines set current_revision_id='10000000-0000-4000-8000-00000000000${n+1}' where id='10000000-0000-4000-8000-000000000001'; commit;`);
    await revise(1);
    const age = () => pg.query("update composer_jobs set requested_at=now()-interval '1 minute' where page_id=$1",[page]);
    const claim = (automatic = true) => db.call<ComposerClaim | null>("claim_composer_job",{p_page_id:page,p_automatic:automatic});
    const finish = (job: ComposerClaim, error: string | null = null) => db.call("finish_composer_job",{p_page_id:page,p_token:job.token,p_error:error});
    expect(await claim()).toBeNull();
    await age();
    const first = (await claim())!;
    expect(first.snapshot.paragraphs[0]!.text).toBe("Version 1");
    expect(await claim(false)).toBeNull();
    await finish(first); // A completed assessment need not have made an image.
    await db.call("enqueue_composer_page",{p_page_id:page}); await age();
    expect(await claim()).toBeNull();
    const manual = (await claim(false))!;
    expect(manual.token).not.toBe(first.token);
    await finish(manual,"Provider unavailable");
    expect(await claim()).toBeNull(); // No endless paid retries for this version.
    await revise(2); await age();
    await pg.query("update sections set status='building' where id=$1",[section]); await age();
    expect(await claim()).toBeNull();
    await pg.query("update sections set status='current' where id=$1",[section]); await age();
    const second = (await claim())!;
    await revise(3); await finish(second); await age();
    const third = (await claim())!;
    expect(third.snapshot.paragraphs[0]!.text).toBe("Version 3");
    await finish(second); // Stale owners cannot release a newer owner's claim.
    expect(await db.call("renew_composer_job",{p_page_id:page,p_token:third.token})).toBe(true);
    await db.call("suppress_composer_page",{p_page_id:page});
    expect(await db.call("renew_composer_job",{p_page_id:page,p_token:third.token})).toBe(false);
    expect(await claim()).toBeNull();
    await pg.exec("set role authenticated");
    await expect(db.call("claim_composer_job")).rejects.toThrow("permission denied");
  } finally { await pg.close(); }
});

it("reuses an unchanged figure after an unrelated article edit", async () => {
  const { pg, db } = await portablePostgres();
  try {
    const page = (await pg.query<{id:string}>("insert into pages(title,slug) values('Reusable test','reusable-test') returning id")).rows[0]!.id;
    const section = (await pg.query<{id:string}>("insert into sections(page_id,title,mode,query,position,status) values($1,'Overview','generated','{}',0,'current') returning id",[page])).rows[0]!.id;
    await pg.exec(`begin; set constraints all deferred;
      insert into lines(id,section_id,position,current_revision_id) values('10000000-0000-4000-8000-000000000001','${section}',0,'10000000-0000-4000-8000-000000000002');
      insert into line_revisions(id,line_id,content,unit_revision_ids,author,event_id) values('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Same facts','{}','ai',(select id from shift_events limit 1)); commit;`);
    const snapshot = await db.call("composer_page_snapshot",{p_page_id:page});
    await db.call("save_composer_run",{p_page_id:page,p_snapshot:snapshot,p_composition:{figures:[{after:'10000000-0000-4000-8000-000000000001',evidence:['10000000-0000-4000-8000-000000000001'],svg:'<svg/>',caption:'Caption',alt:'Description',learningGoal:'Facts'}]},p_review:{},p_model:'test'});
    await pg.query("update pages set title='New title' where id=$1",[page]);
    expect(await db.call("read_composer_run",{p_page_id:page})).toBeNull();
    const reusable = await db.call<{composition:{figures:unknown[]}}>("read_composer_reusable_run",{p_page_id:page});
    expect(reusable.composition.figures).toHaveLength(1);
    await pg.exec(`update line_revisions set content='Different facts' where id='10000000-0000-4000-8000-000000000002'`);
    expect((await db.call<{composition:{figures:unknown[]}}>("read_composer_reusable_run",{p_page_id:page})).composition.figures).toHaveLength(0);
  } finally { await pg.close(); }
});
