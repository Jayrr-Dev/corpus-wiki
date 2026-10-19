import { targetFromEnvironment } from '../scripts/db/targets.ts';
const db = await targetFromEnvironment(process.env);
try {
 for (const [name,sql] of Object.entries({
 config:`select rolname,rolconfig from pg_roles where rolname in ('space_runtime','service_role','authenticator')`,
 pending:`select c.id,c.status,count(a.id) actions from public.change_sets c join public.actions a on a.change_set_id=c.id where c.event_id='811105ea-fcfe-4ac4-9c7d-dc589b1501e4' and c.status='draft' group by c.id,c.status`,
 slow:`select left(query,1400) query,calls,mean_exec_time,max_exec_time from extensions.pg_stat_statements where not toplevel order by total_exec_time desc limit 12`,
 })) {try {console.log(name,JSON.stringify(await db.query(sql)));} catch(e){console.log(name,e.message);}}
} finally {await db.close();}
