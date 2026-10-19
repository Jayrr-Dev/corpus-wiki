import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try {
 console.log(JSON.stringify(await db.query(`select p.proname,p.proconfig,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('read_section_units','read_section_state_before_context')`)));
 for(const jit of ['off','on']){
  const started=Date.now();
  try {const rows=await db.query(`begin;set local statement_timeout='20s';set local jit=${jit};select set_config('request.headers','{"x-space-id":"21132c80-32b3-4ef2-9156-d9af60486173"}',true);select jsonb_array_length(public.read_section_state('f8ae3d68-bbf4-486a-ab88-ea7ea3775e67')->'lines') lines;rollback;`);console.log(JSON.stringify({jit,ms:Date.now()-started,rows}));}
  catch(error){console.log(JSON.stringify({jit,ms:Date.now()-started,error:error.message}));}
 }
}finally{await db.close();}
