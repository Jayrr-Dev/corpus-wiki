const ref=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
const u=new URL(`https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs`);
u.searchParams.set('iso_timestamp_start','2026-10-18T18:49:00Z');u.searchParams.set('iso_timestamp_end',new Date().toISOString());
u.searchParams.set('sql',`select timestamp,event_message message,log_attributes['parsed.context'] context from logs where source='postgres_logs' and log_attributes['parsed.sql_state_code']='57014' and log_attributes['parsed.context'] ilike '%section_build_write%' order by timestamp desc limit 4`);
const r=await fetch(u,{headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`Logs ${r.status}`);const b=await r.json();
console.log(JSON.stringify((b.result??[]).map(x=>({timestamp:x.timestamp,message:x.message,context:String(x.context??'').replace(/'(?:''|[^'])*'/gs,"'[value]'").slice(0,5000)}))));

