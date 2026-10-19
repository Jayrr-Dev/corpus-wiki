import {projectRefFromUrl} from '../scripts/db/targets.ts';
const ref=projectRefFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
const response=await fetch(`https://api.supabase.com/v1/projects/${ref}`,{headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`},signal:AbortSignal.timeout(15000)});
const data=await response.json();
console.log(JSON.stringify({http:response.status,status:data.status,databaseVersion:data.database?.version,hasDirectConnection:!!process.env.SUPABASE_DB_URL}));
const health=await fetch(`https://api.supabase.com/v1/projects/${ref}/health?services=db,db_postgres_user,rest,pooler`,{headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`},signal:AbortSignal.timeout(20000)});
console.log('services',health.status,JSON.stringify(await health.json()));
