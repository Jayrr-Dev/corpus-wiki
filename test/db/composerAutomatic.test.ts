import { expect, it } from "vitest";
import { portablePostgres } from "./portablePostgres";
import type { ComposerClaim } from "@/lib/composer/jobs";

it("skips unfinished pages before snapshot work and computes each candidate snapshot only once", async () => {
  const { pg, db } = await portablePostgres();
  try {
    const page = (await pg.query<{ id: string }>("insert into pages(title,slug) values('Eligibility test','eligibility-test') returning id")).rows[0]!.id;
    await pg.query("insert into sections(page_id,title,mode,query,position,status) values($1,'Overview','manual','{}',0,'building')", [page]);
    await pg.exec(`create table public.test_snapshot_calls(n integer); insert into public.test_snapshot_calls values(0);
      grant select,update on public.test_snapshot_calls to space_runtime;
      create or replace function public.composer_page_snapshot(p_page_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
      begin update public.test_snapshot_calls set n=n+1;
        return '{"paragraphs":[{"text":"A settled paragraph"}]}'::jsonb; end $$;`);
    const count = async () => (await pg.query<{ n: number }>("select n from public.test_snapshot_calls")).rows[0]!.n;
    await pg.query("update composer_jobs set requested_at=now()-interval '1 minute' where page_id=$1", [page]);
    expect(await db.call("claim_composer_job", { p_page_id: page, p_automatic: true })).toBeNull();
    expect(await count()).toBe(0);
    await pg.query("update sections set status='current' where page_id=$1", [page]);
    await pg.query("update composer_jobs set requested_at=now()-interval '1 minute' where page_id=$1", [page]);
    const claim = await db.call<ComposerClaim>("claim_composer_job", { p_page_id: page, p_automatic: true });
    expect(claim.pageId).toBe(page);
    expect(await count()).toBe(1);
    await db.call("finish_composer_job", { p_page_id: page, p_token: claim.token });
    expect(await db.call("claim_composer_job", { p_page_id: page, p_automatic: true })).toBeNull();
    expect(await count()).toBe(2);
    const emptyRun = (await pg.query<{ id: string }>(`insert into composer_runs(page_id,snapshot,composition,review,model,active)
      values($1,'{"paragraphs":[{"text":"A settled paragraph"}]}','{"figures":[]}','{}','test',true) returning id`, [page])).rows[0]!.id;
    expect(await db.call("claim_composer_job", { p_page_id: page, p_automatic: true })).toBeNull();
    expect((await pg.query<{ assessed_illustration_run: string }>("select assessed_illustration_run from composer_jobs where page_id=$1", [page])).rows[0]!.assessed_illustration_run).toBe(emptyRun);
    expect(await count()).toBe(3);
    await pg.query("update composer_runs set active=false where id=$1", [emptyRun]);
    await pg.query(`insert into composer_runs(page_id,snapshot,composition,review,model,active)
      values($1,'{"paragraphs":[{"text":"A settled paragraph"}]}','{"figures":[{"after":"missing","evidence":["missing"],"svg":"<svg/>","caption":"Test","alt":"Test","learningGoal":"Test"}]}','{}','test',true)`, [page]);
    const replacement = await db.call<ComposerClaim>("claim_composer_job", { p_page_id: page, p_automatic: true });
    expect(replacement.pageId).toBe(page);
    expect(await count()).toBe(4); // New runs are checked and reuse that same snapshot.
  } finally { await pg.close(); }
});

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
    await pg.query("update sections set status='current' where id=$1", [section]);
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
    await expect(db.call("read_composer_run_snapshot", { p_page_id: page, p_snapshot: { paragraphs: [] } })).rejects.toThrow("permission denied");
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
    await pg.query("update sections set status='current' where id=$1", [section]);
    const snapshot = await db.call("composer_page_snapshot",{p_page_id:page});
    await db.call("save_composer_run",{p_page_id:page,p_snapshot:snapshot,p_composition:{figures:[{after:'10000000-0000-4000-8000-000000000001',evidence:['10000000-0000-4000-8000-000000000001'],svg:'<svg/>',caption:'Caption',alt:'Description',learningGoal:'Facts'}]},p_review:{},p_model:'test'});
    await pg.query("update pages set title='New title' where id=$1",[page]);
    expect(await db.call("read_composer_run",{p_page_id:page})).toMatchObject({ composition: { figures: expect.any(Array) } });
    const reusable = await db.call<{composition:{figures:unknown[]}}>("read_composer_reusable_run",{p_page_id:page});
    expect(reusable.composition.figures).toHaveLength(1);
    const largeReview = { notes: Array.from({ length: 700 }, (_, i) => `Visual review ${i}: ${i * 7919}`).join("\n") };
    await pg.query("update composer_runs set review=$1::jsonb where page_id=$2", [JSON.stringify(largeReview), page]);
    expect(await db.call("read_composer_reusable_run", { p_page_id: page })).toMatchObject({ review: largeReview, composition: { figures: expect.any(Array) } });
    expect(await db.call("read_composer_reusable_run", { p_page_id: "00000000-0000-4000-8000-000000000000" })).toBeNull();
    await pg.exec(`update line_revisions set content='Different facts' where id='10000000-0000-4000-8000-000000000002'`);
    expect((await db.call<{composition:{figures:unknown[]}}>("read_composer_reusable_run",{p_page_id:page})).composition.figures).toHaveLength(0);
    // Previously assessed text still gets one replacement pass when old drawings
    // become hidden. Failure is remembered rather than retried every worker tick.
    await pg.query("update composer_jobs set assessed_snapshot=composer_page_snapshot(page_id),assessed_illustration_run=null,outcome='completed',requested_at=now()-interval '1 minute' where page_id=$1", [page]);
    const replacement = await db.call<ComposerClaim | null>("claim_composer_job", { p_page_id: page, p_automatic: true });
    expect(replacement).not.toBeNull();
    expect(await db.call("claim_composer_job", { p_page_id: page, p_automatic: true })).toBeNull();
    await db.call("finish_composer_job", { p_page_id: page, p_token: replacement!.token, p_error: "Provider unavailable" });
    expect(await db.call("claim_composer_job", { p_page_id: page, p_automatic: true })).toBeNull();
    await pg.query("update composer_jobs set assessed_illustration_run=null where page_id=$1", [page]);
    await db.call("suppress_composer_page", { p_page_id: page });
    expect(await db.call("claim_composer_job", { p_page_id: page, p_automatic: true })).toBeNull();

  } finally { await pg.close(); }
});
