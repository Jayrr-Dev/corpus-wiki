import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try{console.log(JSON.stringify(await db.query(`select key,state,left(error,240) error,updated_at from upload_steps where event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4' and updated_at>'2026-10-19 00:56:00+00' order by updated_at desc limit 12`)));}finally{await db.close();}
