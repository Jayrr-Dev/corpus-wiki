import {targetFromEnvironment} from '../scripts/db/targets.ts';
const db=await targetFromEnvironment(process.env);
try{
 console.log('transaction result shape',JSON.stringify(await db.query('begin;select 1 as probe;rollback;')));
 console.log('search waits',JSON.stringify(await db.query(`select pid,usename,state,wait_event_type,wait_event,round(extract(epoch from now()-query_start)) seconds,pg_blocking_pids(pid) blockers from pg_stat_activity where state='active' and pid<>pg_backend_pid() and (query like '%similar_units%' or query like '%claim_composer_job%')`)));
 console.log('embedding tables',JSON.stringify(await db.query(`select relname,n_live_tup,last_analyze,last_autoanalyze from pg_stat_user_tables where relname in ('unit_embeddings','units','revisions')`)));
 console.log('function settings',JSON.stringify(await db.query(`select p.proname,r.rolname owner,p.proconfig from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid='public.similar_units(text,text,integer,double precision)'::regprocedure`)));
 console.log('current revision indexes',JSON.stringify(await db.query(`select indexname,indexdef from pg_indexes where schemaname='public' and tablename='units' and indexdef like '%current_revision_id%'`)));
 console.log('invalid vector links',JSON.stringify(await db.query(`select count(*)::int total,count(*) filter(where r.unit_id<>e.unit_id)::int mismatches from public.unit_embeddings e join public.revisions r on r.id=e.revision_id where e.space_id='21132c80-32b3-4ef2-9156-d9af60486173'`)));
}finally{await db.close();}
