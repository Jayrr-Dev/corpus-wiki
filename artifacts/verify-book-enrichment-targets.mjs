import {createServer} from 'vite';
import {resolve} from 'node:path';
import {targetFromEnvironment} from '../scripts/db/targets.ts';
const eventId='811105ea-fcfe-4ac4-9c7d-dc589b1501e4';
const sql=await targetFromEnvironment(process.env);
let actor,added;
try{
 const [event]=await sql.query(`select person_id,space_id from shift_events where id='${eventId}'`);
 const [snapshot]=await sql.query(`select output from upload_steps where event_id='${eventId}' and key='enrichment-input' and state='succeeded'`);
 if(!Array.isArray(snapshot?.output))throw Error('No saved enrichment evidence set');
 added=snapshot.output;
 actor={personId:event.person_id,spaceId:event.space_id,via:'script'};
}finally{await sql.close();}
const runtime=await createServer({configFile:false,appType:'custom',server:{middlewareMode:true,watch:null,hmr:false},resolve:{alias:{'@':resolve('.'),'server-only':resolve('test/server-only.ts')}}});
try{
 const {withSpaceActor}=await runtime.ssrLoadModule('/lib/auth/currentPerson.ts');
 await withSpaceActor(actor,async()=>{
  const {getAdminSupabase}=await runtime.ssrLoadModule('/lib/supabase/admin.ts');
  const {supabaseRpc}=await runtime.ssrLoadModule('/lib/db/rpc.ts');
  const {rebuildAfterEvent}=await runtime.ssrLoadModule('/lib/living-page/index.ts');
  const live=supabaseRpc(getAdminSupabase());
  const targets=[];let candidates=0;
  const reader={async call(fn,args={}){
   if(fn==='claim_section_build'){targets.push(args.p_section_id);return {claimed:false};}
   if(!['list_affected_sections','read_section_state'].includes(fn))throw Error(`Unexpected operation blocked: ${fn}`);
   const result=await live.call(fn,args);
   if(fn==='list_affected_sections')candidates=result.length;
   return result;
  }};
  let reviewed=[];
  const writer={name:'read-only-verification',reviseSection:async()=>{throw Error('AI writing blocked during verification');},reviewSections:async ids=>{reviewed=ids;}};
  await rebuildAfterEvent(reader,writer,eventId,`enrichment:${eventId}`,added);
  console.log(JSON.stringify({newEvidence:added.length,originalCandidates:candidates,actualTargets:targets.length,reviewTargets:reviewed.length,skippedUnchanged:candidates-targets.length,mutations:0,aiCalls:0}));
 });
}finally{await runtime.close();}
