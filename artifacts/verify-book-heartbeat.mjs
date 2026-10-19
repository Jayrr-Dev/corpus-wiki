import { targetFromEnvironment } from '../scripts/db/targets.ts';
import { createClient } from '@supabase/supabase-js';
const db=await targetFromEnvironment(process.env);
const event='811105ea-fcfe-4ac4-9c7d-dc589b1501e4';
let token; let client; let holding;
try {
 const [row]=await db.query(`select person_id,space_id from public.shift_events where id='${event}'`);
 client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{'x-person-id':row.person_id,'x-space-id':row.space_id}}});
 const claim=await client.rpc('claim_upload_workflow',{p_event_id:event,p_continue:false});
 if(claim.error)throw new Error(claim.error.message);
 if(!claim.data.claimed)throw new Error('Already running; cannot run contention verification');
 token=claim.data.token;
 holding=db.query(`begin; set local statement_timeout='20s';
 set local role space_runtime;
 select set_config('request.jwt.claims','{"role":"service_role"}',true);
 select set_config('request.headers',jsonb_build_object('x-space-id','${row.space_id}','x-person-id','${row.person_id}')::text,true);
 select public.assert_upload_lease('${event}','${token}'); select pg_sleep(10); rollback;`);
 // Observe the held row lock before issuing the heartbeat.
 let confirmed=false;
 for(let i=0;i<15;i++) {
  const rows=await db.query(`select 1 from pg_stat_activity where pid<>pg_backend_pid() and state='active' and wait_event='PgSleep' and query like 'begin; set local statement_timeout=%' and query like '%select pg_sleep(10)%'`);
  if(rows.length){confirmed=true; break;}
  await new Promise(r=>setTimeout(r,100));
 }
 if(!confirmed)throw new Error('Could not confirm blocking transaction');
 const started=performance.now();
 const heartbeat=await client.rpc('heartbeat_upload_workflow',{p_event_id:event,p_token:token});
 const elapsedMs=Math.round(performance.now()-started);
 console.log('heartbeatDuringHeldLock',JSON.stringify({elapsedMs,error:heartbeat.error}));
 if(heartbeat.error || elapsedMs>4000)throw new Error('Heartbeat waited for the transactional save lock');
 await holding;
} finally {
 if(holding)await holding.catch(()=>{});
 if(token)await client.rpc('release_upload_workflow',{p_event_id:event,p_token:token,p_state:'incomplete',p_error:null});
 await db.close();
}
