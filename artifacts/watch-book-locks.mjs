import { targetFromEnvironment } from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try {
 for(let i=0;i<28;i++) {
  const rows=await db.query(`select a.pid,a.wait_event_type,a.wait_event,extract(epoch from now()-a.query_start) seconds,left(a.query,180) query,
    (select jsonb_agg(jsonb_build_object('relation',l.relation::regclass::text,'mode',l.mode,'granted',l.granted,'pid',l.pid)) from pg_locks l where l.pid=a.pid or l.pid=any(pg_blocking_pids(a.pid))) locks,
    (select jsonb_agg(jsonb_build_object('pid',b.pid,'state',b.state,'seconds',extract(epoch from now()-b.query_start),'query',left(b.query,900))) from pg_stat_activity b where b.pid=any(pg_blocking_pids(a.pid))) blockers
    from pg_stat_activity a where a.state='active' and a.pid<>pg_backend_pid() and (a.query ilike '%upload_workflow_write%' or a.wait_event_type='Lock')`);
  if(rows.length)console.log(new Date().toISOString(),JSON.stringify(rows));
  await new Promise(r=>setTimeout(r,2000));
 }
} finally {await db.close();}
