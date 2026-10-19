const ref=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
if(ref!=='qeuvxnvwommyjdzxoodd')throw Error('Unexpected project');
const headers={Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`};
const response=await fetch(`https://api.supabase.com/v1/projects/${ref}`,{headers,signal:AbortSignal.timeout(30000)});
if(!response.ok)throw Error(`Project status ${response.status}`);
const p=await response.json();console.log(JSON.stringify({id:p.id,status:p.status,region:p.region,databaseVersion:p.database?.version}));
const h=await fetch(`https://api.supabase.com/v1/projects/${ref}/health?services=db,rest,auth`,{headers,signal:AbortSignal.timeout(20000)});
console.log('Services',h.status,(await h.text()).slice(0,1500));

