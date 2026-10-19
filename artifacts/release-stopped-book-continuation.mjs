import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try{console.log(JSON.stringify(await db.query(`begin;
select set_config('request.headers','{"x-space-id":"21132c80-32b3-4ef2-9156-d9af60486173"}',true);
select public.mark_section_stale(s.id) from sections s where s.status='building' and s.retired_at is null
and exists(select 1 from upload_steps step where step.event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4' and step.state='running' and step.key like 'rebuild-section:enrichment:%' and right(step.key,36)=s.id::text)
and not exists(select 1 from upload_workflows where event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4' and lease_until>now());
select public.finish_upload_recovery(q.event_id,q.token,null) from upload_recovery_jobs q where q.event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4' and q.token is not null
and not exists(select 1 from upload_workflows where event_id=q.event_id and lease_until>now());
commit;`)));}finally{await db.close();}
