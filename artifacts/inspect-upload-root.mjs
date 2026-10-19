import {targetFromEnvironment} from '../scripts/db/targets.ts';
import {createServer} from 'vite';
import {resolve} from 'node:path';
const event='811105ea-fcfe-4ac4-9c7d-dc589b1501e4';
const sql=await targetFromEnvironment(process.env);
let runtime;
try {
 const exceptions=await sql.query(`select x.id,x.reason,a.type,a.input,c.id as change_set_id from exceptions x join actions a on a.id=x.action_id join change_sets c on c.id=a.change_set_id where c.event_id='${event}' and x.status='open' order by x.id`);
 console.log(JSON.stringify(exceptions.map(x=>({id:x.id,reason:x.reason,type:x.type,path:x.input.path,parent:x.input.parentPath,changeSetId:x.change_set_id}))));
 const approvedId=process.argv[2];
 if(approvedId) {
 const selected=exceptions.find(x=>x.id===approvedId);
 if(!selected||selected.reason!=='root_domain_approval'||selected.type!=='create_domain'||selected.input.path!=='Enneagram')throw Error('This helper only approves the inspected Enneagram root for this upload.');
 const [actor]=await sql.query(`select person_id,space_id from shift_events where id='${event}'`);
 runtime=await createServer({configFile:false,appType:'custom',server:{middlewareMode:true,watch:null,hmr:false},resolve:{alias:{'@':resolve('.'),'server-only':resolve('test/server-only.ts')}}});
 const {withSpaceActor}=await runtime.ssrLoadModule('/lib/auth/currentPerson.ts');
 const {getAdminSupabase}=await runtime.ssrLoadModule('/lib/supabase/admin.ts');
 const {supabaseRpc}=await runtime.ssrLoadModule('/lib/db/rpc.ts');
 const {resolveException}=await runtime.ssrLoadModule('/lib/change-control/index.ts');
 await withSpaceActor({personId:actor.person_id,spaceId:actor.space_id,via:'script'},async()=>{
  const result=await resolveException(supabaseRpc(getAdminSupabase()),{exceptionId:selected.id,accept:true,note:'Approved the Enneagram topic root to complete the test upload, as requested by the user.'});
  console.log('Root approval result',JSON.stringify(result));
 });
 }
}finally{await runtime?.close();await sql.close();}
