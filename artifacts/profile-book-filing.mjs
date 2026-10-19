import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
const event='811105ea-fcfe-4ac4-9c7d-dc589b1501e4';
try {
 for(const [name,expression]of Object.entries({vectors:`(select jsonb_agg(jsonb_build_object('revisionId',e.revision_id,'model',e.model,'embedding',e.embedding::text)) from public.unit_embeddings e join public.units u on u.current_revision_id=e.revision_id where u.retired_at is null)`,evidence:`(select jsonb_agg(jsonb_build_object('unitId',u.id,'passages',coalesce((select jsonb_agg(jsonb_build_object('location',p.location,'text',p.text) order by p.position) from public.passages p where p.id=any(r.passage_ids)),'[]'))) from public.units u join public.revisions r on r.id=u.current_revision_id where u.retired_at is null and exists(select 1 from public.actions a join public.change_sets c on c.id=a.change_set_id where c.event_id='${event}' and a.target_id=u.id and a.outcome='applied' and a.type::text in ('add_claim','revise_claim')))`})) {
  const start=performance.now();
  const rows=await db.query(`begin; set local statement_timeout='60s'; set local jit=off; set local role space_runtime;
  select set_config('request.jwt.claims','{"role":"service_role"}',true);
  select set_config('request.headers','{"x-space-id":"21132c80-32b3-4ef2-9156-d9af60486173"}',true);
  explain(analyze,format json) select octet_length((${expression})::text); rollback;`);
  console.log(name,JSON.stringify({elapsedMs:Math.round(performance.now()-start),plan:rows.find(r=>r['QUERY PLAN'])?.['QUERY PLAN']?.[0]?.['Execution Time']}));
 }
} finally {await db.close();}
