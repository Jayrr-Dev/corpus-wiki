import { targetFromEnvironment } from '../scripts/db/targets.ts';
import { createClient } from '@supabase/supabase-js';
const db=await targetFromEnvironment(process.env);
const event='811105ea-fcfe-4ac4-9c7d-dc589b1501e4';
let token;
let timer;
let client;
try {
 const [row]=await db.query(`select e.person_id,e.space_id,c.id from public.shift_events e join public.change_sets c on c.event_id=e.id where e.id='${event}' and c.status='draft' order by c.created_at limit 1`);
 if(!row) throw new Error('No pending saved draft');
 client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{'x-person-id':row.person_id,'x-space-id':row.space_id,'x-via':'book-recovery'}}});
 const claim=await client.rpc('claim_upload_workflow',{p_event_id:event,p_continue:false});
 if(claim.error)throw new Error(claim.error.message);
 if(!claim.data.claimed)throw new Error('Workflow is already owned; leave it running');
 token=claim.data.token;
 timer=setInterval(()=>void db.query(`select wait_event_type,wait_event,left(query,250) query,extract(epoch from now()-query_start) seconds from pg_stat_activity where state='active' and pid<>pg_backend_pid() and query ilike '%upload_workflow_write%'`).then(rows=>console.log('active',JSON.stringify(rows))).catch(e=>console.log('observe',e.message)),1500);
 const started=performance.now();
 const save=await client.rpc('upload_workflow_write',{p_event_id:event,p_token:token,p_key:`commit:${row.id}`,p_function:'commit_change_set',p_args:{p_change_set_id:row.id}});
 console.log('save',JSON.stringify({durationMs:Math.round(performance.now()-started),error:save.error,result:save.data}));
} finally {
 clearInterval(timer);
 if(token) {const released=await client.rpc('release_upload_workflow',{p_event_id:event,p_token:token,p_state:'incomplete',p_error:null});console.log('release',JSON.stringify({error:released.error}));}
 await db.close();
}
