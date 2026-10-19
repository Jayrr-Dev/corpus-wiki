import {writeFile} from 'node:fs/promises';
const ref=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
if(ref!=='qeuvxnvwommyjdzxoodd')throw Error('Unexpected project');
const headers={Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'};
async function request(options={}){const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/postgrest`,{headers,signal:AbortSignal.timeout(30000),...options});if(!r.ok)throw Error(`Pool configuration ${r.status}`);return r.json();}
const before=await request();
await writeFile('artifacts/book-api-pool-before.json',JSON.stringify({ref,db_pool:before.db_pool,db_pool_acquisition_timeout:before.db_pool_acquisition_timeout,observedEffectivePool:10,recordedAt:new Date().toISOString()},null,2),{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
await request({method:'PATCH',body:JSON.stringify({db_pool:4})});
const after=await request();if(after.db_pool!==4)throw Error('Pool change unconfirmed');
console.log(JSON.stringify({ref,db_pool:after.db_pool,db_pool_acquisition_timeout:after.db_pool_acquisition_timeout}));
