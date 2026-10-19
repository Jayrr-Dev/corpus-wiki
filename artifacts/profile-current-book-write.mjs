import { targetFromEnvironment } from '../scripts/db/targets.ts';
const db = await targetFromEnvironment(process.env);
const event = '811105ea-fcfe-4ac4-9c7d-dc589b1501e4';
try {
  const drafts = await db.query(`select c.id,count(a.id) actions from public.change_sets c join public.actions a on a.change_set_id=c.id where c.event_id='${event}' and c.status='draft' group by c.id order by c.id`);
  console.log('pending', JSON.stringify(drafts));
  for (const draft of drafts.slice(0, 1)) for (const mode of ['force_generic_plan','force_custom_plan']) {
    const started = performance.now();
    const result = await db.query(`discard plans; begin; set local statement_timeout='20s'; set local pg_stat_statements.track='all'; set local jit=off; set local plan_cache_mode=${mode};
      set local role space_runtime;
      select set_config('request.jwt.claims','{"role":"service_role"}',true);
      select set_config('request.headers',jsonb_build_object('x-space-id','21132c80-32b3-4ef2-9156-d9af60486173','x-person-id',(select person_id from public.shift_events where id='${event}'))::text,true);
      select public.claim_upload_workflow('${event}',false);
      explain(analyze,buffers,format json) select public.upload_workflow_write('${event}',
        (select token from public.upload_workflows where event_id='${event}'),
        'commit:${draft.id}','commit_change_set',jsonb_build_object('p_change_set_id','${draft.id}'));
      rollback;`);
    const plan = result.find(row => row['QUERY PLAN'])?.['QUERY PLAN']?.[0];
    console.log('profile', JSON.stringify({mode,elapsedMs:Math.round(performance.now()-started),databaseMs:plan?.['Execution Time']}));
  }
} finally { await db.close(); }
