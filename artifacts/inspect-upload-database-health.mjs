import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try{
 const start=performance.now();
 console.log('database',JSON.stringify(await db.query("select now() observed_at,pg_is_in_recovery() in_recovery,current_setting('default_table_access_method') storage_engine")));
 console.log('health_read_ms',Math.round(performance.now()-start));
 console.log('replication',JSON.stringify(await db.query("select slot_name,plugin,slot_type,active,temporary,wal_status from pg_replication_slots order by slot_name")));
 console.log('replication workers',JSON.stringify(await db.query("select backend_type,application_name,state from pg_stat_activity where backend_type='walsender'")));
}finally{await db.close();}
