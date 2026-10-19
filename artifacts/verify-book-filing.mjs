import {targetFromEnvironment} from '../scripts/db/targets.ts';
import {createClient} from '@supabase/supabase-js';
const db=await targetFromEnvironment(process.env);
try{
 const event='811105ea-fcfe-4ac4-9c7d-dc589b1501e4';
 const [row]=await db.query(`select person_id,space_id from public.shift_events where id='${event}'`);
 const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{'x-person-id':row.person_id,'x-space-id':row.space_id}}});
 const start=performance.now();const result=await client.rpc('upload_topic_context',{p_event_id:event});
 console.log(JSON.stringify({durationMs:Math.round(performance.now()-start),error:result.error,claims:result.data?.claims?.length,evidence:result.data?.evidence?.length,vectors:result.data?.vectors?.length,domains:result.data?.domainPaths?.length,bytes:result.data?JSON.stringify(result.data).length:null,parts:result.data?Object.fromEntries(Object.entries(result.data).map(([k,v])=>[k,JSON.stringify(v).length])):null}));
}finally{await db.close();}
