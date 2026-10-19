import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try{
console.log('failed',JSON.stringify(await db.query(`select key,error from upload_steps where event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4' and state='failed' and key like 'rebuild-section:%' order by updated_at desc limit 4`)));
console.log('owners',JSON.stringify(await db.query(`select id,status,build_cancelled,building_since,rebuild_requested,rebuild_event_id from sections where space_id='21132c80-32b3-4ef2-9156-d9af60486173' and retired_at is null and (build_cancelled or status='building') order by building_since nulls first limit 12`)));
}finally{await db.close();}
