const ref=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
if(ref!=='qeuvxnvwommyjdzxoodd')throw Error('Unexpected project');
const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/metrics`,{headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`Metrics ${r.status}`);
const lines=(await r.text()).split('\n');
console.log(lines.filter(x=>/^(?:node_load[15]|node_memory_(?:MemTotal|MemAvailable|SwapFree|SwapTotal)_bytes|node_filesystem_(?:avail|size)_bytes|node_cpu_seconds_total|pg_stat_database_numbackends|pg_settings_max_connections)/.test(x)).slice(0,45).join('\n'));
