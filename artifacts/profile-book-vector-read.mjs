import {targetFromEnvironment} from '../scripts/db/targets.ts';
import {quoteLiteral} from '../scripts/db/migrate.ts';
const db=await targetFromEnvironment(process.env);
try {
 console.log('indexes',JSON.stringify(await db.query("select indexname,indexdef from pg_indexes where schemaname='public' and tablename='unit_embeddings'")));
 const [actor]=await db.query("select person_id,space_id from shift_events where id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4'");
 const [vector]=await db.query("select embedding::text as embedding,model from unit_embeddings where space_id='21132c80-32b3-4ef2-9156-d9af60486173' limit 1");
 if(!vector)throw Error('No stored book vector');
 for(const jit of ['on','off']){
  const started=performance.now();
  try {
   await db.query(`begin; set local statement_timeout='12s'; set local jit=${jit};select set_config('request.jwt.claims','{"role":"service_role"}',true);select set_config('request.headers',${quoteLiteral(JSON.stringify({'x-person-id':actor.person_id,'x-space-id':actor.space_id,'x-via':'script'}))},true);set local role space_runtime;select * from public.similar_units(${quoteLiteral(vector.embedding)},${quoteLiteral(vector.model)},16,0.6);rollback;`);
   console.log(JSON.stringify({jit,completed:true,elapsedMs:Math.round(performance.now()-started)}));
  }catch(error){console.log(JSON.stringify({jit,completed:false,elapsedMs:Math.round(performance.now()-started),error:error.message}));}
 }
}finally{await db.close();}
