import { createServer } from 'vite';
import { resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { targetFromEnvironment } from '../scripts/db/targets.ts';
// This executor owns the upload only. The running app already owns the
// illustration queue; a second resident worker needlessly scans every space.
process.env.COMPOSER_AUTO_ENABLED='false';
const eventId=process.argv[2];
if(!/^[0-9a-f-]{36}$/i.test(eventId??''))throw Error('Supply the upload event ID.');
const sql=await targetFromEnvironment(process.env);
const [event]=await sql.query(`select e.id,e.person_id,e.space_id,s.title from shift_events e join sources s on s.id=e.source_id where e.id='${eventId}' and s.archived_at is null`);
await sql.close();
if(!event)throw Error('Active source upload not found.');
const runtime=await createServer({configFile:false,appType:'custom',server:{middlewareMode:true,watch:null,hmr:false},resolve:{alias:{'@':resolve('.'),'server-only':resolve('test/server-only.ts')}}});
let timer;
try {
 const {withSpaceActor}=await runtime.ssrLoadModule('/lib/auth/currentPerson.ts');
 const {getAdminSupabase}=await runtime.ssrLoadModule('/lib/supabase/admin.ts');
 const {supabaseRpc}=await runtime.ssrLoadModule('/lib/db/rpc.ts');
 const {processUploadEvent}=await runtime.ssrLoadModule('/lib/ingest/index.ts');
 await withSpaceActor({personId:event.person_id,spaceId:event.space_id,via:'script'},async()=>{
  const db=supabaseRpc(getAdminSupabase());
  const read=async()=>(await db.call('read_upload_workflows',{p_event_ids:[eventId]}))[0];
  if(process.argv.includes('--restart')) {
   console.log('Restarting the test upload through the cancellation API; retaining saved checkpoints.');
   await db.call('cancel_upload_workflow',{p_event_id:eventId});
   const deadline=Date.now()+120000;
   while(true){const state=await read();if(state.state!=='running'||!state.lease_until||Date.parse(state.lease_until)<=Date.now())break;if(Date.now()>deadline)throw Error('Old worker did not release; refusing concurrent takeover.');await pause(1000);}
  }
  if(process.argv.includes('--pause-only'))return;
  let polling=false,last='';
  timer=setInterval(()=>{if(polling)return;polling=true;void read().then(state=>{const value=JSON.stringify({state:state.state,progress:state.progress,waiting:state.waiting,failed:state.steps.filter(s=>s.state==='failed'&&!s.key.includes(':')).map(s=>({key:s.key,error:s.error}))});if(value!==last){last=value;console.log(new Date().toISOString(),value);}}).catch(error=>console.log('Status read interrupted:',error.message)).finally(()=>{polling=false;});},30000);
  for(let attempt=0;attempt<3;attempt++) {
   const result=await processUploadEvent(eventId,'articles',false);
   console.log('Run result',JSON.stringify({status:result.status,error:result.error,state:result.workflow?.state,waiting:result.workflow?.waiting,progress:result.workflow?.progress}));
   if(result.workflow?.state==='complete'&&!result.error){console.log('All workflow stages completed.');return;}
   if(result.workflow?.waiting)throw Error('Upload is awaiting a specific approval.');
   if(result.workflow?.cancel_requested)throw Error('Upload was cancelled; refusing automatic restart.');
   if(!result.error&&result.workflow?.state==='running')throw Error('Another worker owns the upload; refusing concurrent processing.');
   if(attempt<2)await pause(15000);
  }
  throw Error('Upload remains unfinished after bounded retries; inspect saved diagnostics.');
 });
}finally{clearInterval(timer);await runtime.close();}
