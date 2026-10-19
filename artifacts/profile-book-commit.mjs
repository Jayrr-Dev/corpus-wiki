import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try {
  console.log('pending',JSON.stringify(await db.query(`select a.position,a.type,a.outcome,a.input->>'content' content from public.actions a where a.change_set_id='091c6717-3809-488b-9eed-f96e67c53e5b' order by a.position`)));
  console.log('activity',JSON.stringify(await db.query(`select pid,wait_event_type,wait_event,left(query,180) query from pg_stat_activity where state='active' and pid<>pg_backend_pid()`)));
  console.log('profile',JSON.stringify(await db.query(`begin;
    set local statement_timeout='45s';
    set local role space_runtime;
    select set_config('request.jwt.claims','{"role":"service_role"}',true);
    select set_config('request.headers',jsonb_build_object('x-space-id','21132c80-32b3-4ef2-9156-d9af60486173','x-person-id',(select person_id from public.shift_events where id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4'))::text,true);
    select public.claim_upload_workflow('811105ea-fcfe-4ac4-9c7d-dc589b1501e4',false);
    explain(analyze,buffers,format json) select public.upload_workflow_write('811105ea-fcfe-4ac4-9c7d-dc589b1501e4',
      (select token from public.upload_workflows where event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4'),
      'commit:091c6717-3809-488b-9eed-f96e67c53e5b','commit_change_set','{"p_change_set_id":"091c6717-3809-488b-9eed-f96e67c53e5b"}');
    rollback;`)));
} finally {await db.close();}
