import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try{console.log(JSON.stringify(await db.query(`select pid,state,wait_event_type,wait_event,extract(epoch from now()-query_start)::int seconds,left(query,180) query,pg_blocking_pids(pid) blockers from pg_stat_activity where pid<>pg_backend_pid() and state<>'idle' and backend_type='client backend' order by query_start limit 8`)));}finally{await db.close();}
