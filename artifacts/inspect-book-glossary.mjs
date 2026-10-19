import {targetFromEnvironment} from '../scripts/db/targets.ts';
import {quoteLiteral} from '../scripts/db/migrate.ts';
const db=await targetFromEnvironment(process.env);
try{
 console.log('ownership',JSON.stringify(await db.query(`select status,lease_until,lease_until>now() lease_active,input_hash is not null has_published_hash,
  completed_batches,total_batches,left(error,700) error
  from glossary_state where space_id='21132c80-32b3-4ef2-9156-d9af60486173'`)));
 const [actor]=await db.query("select person_id,space_id from shift_events where id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4'");
 // The supported reader materializes these JSONB fields separately. A direct
 // projection of live_entries beside review_cache crashes OrioleDB detoasting.
 console.log('published/live view',JSON.stringify(await db.query(`begin;set local statement_timeout='8s';
  select set_config('request.jwt.claims','{"role":"service_role"}',true);
  select set_config('request.headers',${quoteLiteral(JSON.stringify({'x-person-id':actor.person_id,'x-space-id':actor.space_id,'x-via':'script'}))},true);
  set local role space_runtime;
  with v as materialized(select public.read_glossary_view() value) select value->>'status' status,value->>'error' error,
   jsonb_array_length(value->'entries') published_entries,jsonb_array_length(value->'live_entries') live_entries,
   value->'review_progress' review_progress from v;rollback;`)));
 console.log('recent dictionary calls',JSON.stringify(await db.query(`select purpose,count(*)::int calls,max(created_at) latest from ai_calls where space_id='21132c80-32b3-4ef2-9156-d9af60486173' and purpose like 'glossary%' and created_at>now()-interval '5 minutes' group by purpose`)));
}finally{await db.close();}
