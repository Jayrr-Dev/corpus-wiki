import {projectRefFromUrl} from '../scripts/db/targets.ts';
const ref=projectRefFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
const url=new URL(`https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs`);
url.searchParams.set('iso_timestamp_start','2026-10-18T23:54:00Z');
url.searchParams.set('iso_timestamp_end',new Date().toISOString());
url.searchParams.set('sql',"select event_message, log_attributes['parsed.error_severity'] severity, log_attributes['parsed.timestamp'] at from logs where source='postgres_logs' and log_attributes['parsed.error_severity'] in ('ERROR','FATAL','PANIC') limit 8");
const response=await fetch(url,{headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`},signal:AbortSignal.timeout(20000)});
console.log(response.status,JSON.stringify(await response.json()));
