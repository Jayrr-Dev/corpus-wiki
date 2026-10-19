import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try{
console.log(JSON.stringify(await db.query(`select last_error,attempts from upload_recovery_jobs where event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4'`)));
console.log(JSON.stringify(await db.query(`select key,left(error,500) error,updated_at from upload_steps where event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4' and state='failed' order by updated_at desc limit 4`)));
}finally{await db.close();}
