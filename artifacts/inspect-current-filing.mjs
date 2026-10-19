import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try {
 for(const [name,sql]of Object.entries({
 repairs:`select key,output->'history' as history from upload_steps where event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4' and key like '%:repair-v1:%' order by updated_at desc limit 1`,
 size:`select sum(length((output->'groups')::text)) as plan_characters,sum(jsonb_array_length(output->'groups')) groups from upload_steps where event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4' and state='succeeded' and key like 'place-v4:%:plan:%'`,
 recovery:`select attempts,available_at,lease_until,last_error from upload_recovery_jobs where event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4'`,
 }))console.log(name,JSON.stringify(await db.query(sql)));
}finally{await db.close();}
