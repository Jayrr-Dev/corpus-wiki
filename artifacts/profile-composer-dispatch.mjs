import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try {
 for(const jit of ['on','off']) {
  const started=performance.now();
  try {
   await db.query(`begin; set local statement_timeout='12s'; set local jit=${jit}; select set_config('request.headers',jsonb_build_object('x-space-id',(select id::text from public.spaces where name='My Space' limit 1))::text,true); set local role space_runtime; select public.claim_composer_job(null,true); rollback;`);
   console.log(JSON.stringify({jit,elapsedMs:Math.round(performance.now()-started),completed:true,rolledBack:true}));
  } catch(error) {console.log(JSON.stringify({jit,elapsedMs:Math.round(performance.now()-started),completed:false,error:error.message}));}
 }
}finally{await db.close();}
