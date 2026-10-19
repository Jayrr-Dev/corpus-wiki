import {projectRefFromUrl} from '../scripts/db/targets.ts';
const ref=projectRefFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
if(ref!=='qeuvxnvwommyjdzxoodd')throw Error('Unexpected project; no restart attempted.');
const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/restart`,{
 method:'POST',headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`},signal:AbortSignal.timeout(30000)});
console.log(JSON.stringify({restartHttp:response.status,result:await response.text()}));
if(!response.ok)process.exitCode=1;
