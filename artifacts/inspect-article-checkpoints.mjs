import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try{
 console.log('proposal progress',JSON.stringify(await db.query(`with effective as (
  select case when recovery.state='succeeded' then recovery.state else base.state end state,
   case when recovery.state='succeeded' then recovery.output else base.output end output
  from upload_steps base left join upload_steps recovery on recovery.event_id=base.event_id and recovery.key=base.key||':outline-rubric-recovery-v1'
  where base.event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4' and base.key ~ '^article:811105ea-fcfe-4ac4-9c7d-dc589b1501e4:[0-9]+:[a-f0-9]+$'
 ) select state,output->>'verdict' verdict,count(*)::int proposals from effective group by state,output->>'verdict' order by state,verdict`)));
 console.log('review audits',JSON.stringify(await db.query(`select verdict,count(*)::int reviews,count(*) filter(where proposal ? 'outlineReview')::int with_outline_history from article_reviews where event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4' group by verdict`)));
 console.log('steps',JSON.stringify(await db.query(`select key,state,left(error,3500) error,jsonb_array_length(output->'planned') as proposals from upload_steps where event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4' and (key like 'article%' or key in ('plan','pages')) order by updated_at desc limit 16`)));
 console.log('calls',JSON.stringify(await db.query(`select created_at,purpose,model,duration_ms,status,left(error,400) error from ai_calls where space_id='21132c80-32b3-4ef2-9156-d9af60486173' and purpose not like 'glossary%' and created_at>now()-interval '12 minutes' order by created_at desc limit 10`)));
}finally{await db.close();}
