import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try{
 for(const jit of ['on','off']){
  const start=Date.now();
  try{const rows=await db.query(`begin;set local statement_timeout='25s';set local jit=${jit};select set_config('request.headers','{"x-space-id":"21132c80-32b3-4ef2-9156-d9af60486173"}',true);explain(analyze,buffers,format json) select public.list_affected_sections('811105ea-fcfe-4ac4-9c7d-dc589b1501e4');rollback;`);console.log(JSON.stringify({jit,ms:Date.now()-start,rows}));}catch(error){console.log(JSON.stringify({jit,ms:Date.now()-start,error:error.message}));}
 }
}finally{await db.close();}
