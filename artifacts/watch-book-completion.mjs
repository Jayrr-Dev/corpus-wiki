import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
const event='811105ea-fcfe-4ac4-9c7d-dc589b1501e4';
try{
const [workflow]=await db.query(`select now() checked_at,state,error,progress,updated_at,lease_until,cancel_requested from upload_workflows where event_id='${event}'`);
const steps=await db.query(`select key,state,attempts,left(error,300) error,updated_at from upload_steps where event_id='${event}' and (key in ('pages','articles-ready','describe','profiles','expand','embeddings-enrichment','hierarchy-enrichment','plan-enrichment','glossary','curate','pages-enrichment') or (key like 'editorial-review:%' and state<>'succeeded')) order by updated_at desc limit 8`);
const calls=await db.query(`select purpose,subject,status,left(error,220) error,created_at,duration_ms from ai_calls where space_id='21132c80-32b3-4ef2-9156-d9af60486173' order by created_at desc limit 2`);
console.log(JSON.stringify({workflow,steps,calls}));
}finally{await db.close();}
