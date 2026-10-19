import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try {
for(const [name,sql] of Object.entries({
steps:`select key,state,error,updated_at from upload_steps where event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4' and key like 'article-scaffold:%' order by updated_at desc limit 5`,
sections:`select id,title,status,building_since,build_cancelled,rebuild_requested from sections where page_id='0f568ca8-41e6-4a55-ab96-ed572849f427' and retired_at is null order by position`,
activity:`select pid,state,wait_event_type,wait_event,extract(epoch from now()-query_start) seconds,left(query,220) query from pg_stat_activity where state<>'idle' and pid<>pg_backend_pid() order by query_start limit 8`,
calls:`select created_at,purpose,subject,status,left(error,180) error from ai_calls order by created_at desc limit 4`
})) {try {console.log(name,JSON.stringify(await db.query(sql)));}catch(e){console.log(name,e.message);}}
}finally{await db.close();}
