import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try{
console.log('active',JSON.stringify(await db.query(`select pid,backend_type,state,wait_event_type,wait_event,round(extract(epoch from now()-query_start)) age_s,pg_blocking_pids(pid) blockers from pg_stat_activity where datname=current_database() and state<>'idle' and pid<>pg_backend_pid() order by query_start limit 18`)));
console.log('timeouts',JSON.stringify(await db.query(`select rolname,rolconfig from pg_roles where rolname in ('authenticator','service_role','space_runtime')`)));
}finally{await db.close();}
