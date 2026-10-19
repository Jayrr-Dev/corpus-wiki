import {createServer} from 'vite';
import {resolve} from 'node:path';
import {targetFromEnvironment} from '../scripts/db/targets.ts';
const eventId='811105ea-fcfe-4ac4-9c7d-dc589b1501e4';
const sql=await targetFromEnvironment(process.env);
let actor;
try {
 const [workflow]=await sql.query(`select state,cancel_requested,lease_until>now() active from upload_workflows where event_id='${eventId}'`);
 if(workflow.active||workflow.cancel_requested)throw Error('An active owner or cancellation exists; no duplicate run started.');
 const [event]=await sql.query(`select person_id,space_id from shift_events where id='${eventId}'`);
 actor={personId:event.person_id,spaceId:event.space_id,via:'script'};
}finally{await sql.close();}
const runtime=await createServer({configFile:false,appType:'custom',server:{middlewareMode:true,watch:null,hmr:false},resolve:{alias:{'@':resolve('.'),'server-only':resolve('test/server-only.ts')}}});
try {
 const {withSpaceActor}=await runtime.ssrLoadModule('/lib/auth/currentPerson.ts');
 await withSpaceActor(actor,async()=>{
  const {processUploadEvent}=await runtime.ssrLoadModule('/lib/ingest/index.ts');
  const result=await processUploadEvent(eventId,'articles',true);
  console.log('BOOK_RUN_RESULT',JSON.stringify({status:result.status,error:result.error,workflowState:result.workflow?.state}));
 });
}finally{await runtime.close();}
