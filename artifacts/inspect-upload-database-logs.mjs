const ref=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
const url=new URL(`https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs`);
url.searchParams.set('iso_timestamp_start','2026-10-18T17:40:00Z');
const sinceIndex=process.argv.indexOf('--since');
if(sinceIndex>=0){const since=process.argv[sinceIndex+1];if(!Number.isFinite(Date.parse(since)))throw Error('Invalid log start time');url.searchParams.set('iso_timestamp_start',since);}
url.searchParams.set('iso_timestamp_end',new Date().toISOString());
url.searchParams.set('sql',`select timestamp,log_attributes['parsed.error_severity'] severity,
 log_attributes['parsed.sql_state_code'] sqlstate,substring(event_message,1,900) message
 from logs where source='postgres_logs' and (
 log_attributes['parsed.error_severity'] in ('PANIC','FATAL')
 or match(event_message,'(?i)invalid memory|signal 11|reinitializ|database system is|terminated by signal|crash recovery|out of memory'))
 order by timestamp desc limit 40`);
if(process.argv.includes('--crashes'))url.searchParams.set('sql',`select timestamp,event_message message,
 log_attributes['parsed.detail'] detail,log_attributes['parsed.context'] context,
 mapKeys(log_attributes) attribute_keys
 from logs where source='postgres_logs' and (event_message ilike '%terminated by signal%' or event_message ilike '%Failed process was running%')
 order by timestamp desc limit 20`);
const response=await fetch(url,{headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`},signal:AbortSignal.timeout(30000)});
const body=await response.text();
const safe=body.replaceAll(process.env.SUPABASE_ACCESS_TOKEN??'__no_token__','[redacted]');
if(!response.ok)throw Error(`Project log read ${response.status}: ${safe.slice(0,500)}`);
if(process.argv.includes('--crashes')){
 const result=JSON.parse(safe);
 console.log(JSON.stringify((result.result??[]).slice(0,6).map(row=>{
  const statement=String(row.detail??'')+' '+String(row.context??'');
  return {timestamp:row.timestamp,message:String(row.message).split('\n')[0],
   detailLength:String(row.detail??'').length,statementKind:String(row.detail??'').match(/Failed process was running:\s*([A-Za-z_]+)/i)?.[1],
   statement:statement.replace(/'(?:''|[^'])*'/gs,"'[value]'").slice(0,600),
   functions:[...new Set([...statement.matchAll(/"?(?:public|change_control)"?\."?([a-z_][a-z_0-9]*)"?\s*\(/gi)].map(match=>match[1]))],
   objects:['glossary_state','review_cache','live_entries','composer_runs','unit_embeddings','similar_units','upload_workflow_write','read_glossary_view'].filter(name=>statement.includes(name)),
   context:row.context};
 })));
}else console.log(safe);
