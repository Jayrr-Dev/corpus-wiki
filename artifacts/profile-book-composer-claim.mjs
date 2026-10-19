import {readFile} from 'node:fs/promises';
import {targetFromEnvironment} from '../scripts/db/targets.ts';
import {quoteLiteral} from '../scripts/db/migrate.ts';
const db=await targetFromEnvironment(process.env);
try{
 const [actor]=await db.query("select person_id,space_id from shift_events where id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4'");
 const spaces=await db.query(`select id,name from spaces where id=${quoteLiteral(actor.space_id)} or (owner_id=${quoteLiteral(actor.person_id)} and name='My Space') order by id`);
 const migration=process.argv.includes('--trial')?await readFile('supabase/migrations/20261118211000_composer_claim_candidates.sql','utf8'):'';
 for(const space of spaces){
  const start=performance.now();
  try{
   const result=await db.query(`begin;set local statement_timeout='10s';${migration}
    select set_config('request.jwt.claims','{"role":"service_role"}',true);
    select set_config('request.headers',${quoteLiteral(JSON.stringify({'x-person-id':actor.person_id,'x-space-id':space.id,'x-via':'script'}))},true);
    set local role space_runtime;select public.claim_composer_job(null,true) is not null as found_work;rollback;`);
   console.log(JSON.stringify({space:space.name,trial:!!migration,elapsedMs:Math.round(performance.now()-start),rolledBack:true,result}));
  }catch(error){console.log(JSON.stringify({space:space.name,trial:!!migration,elapsedMs:Math.round(performance.now()-start),error:error.message}));}
 }
}finally{await db.close();}
