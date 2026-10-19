import { targetFromEnvironment } from '../scripts/db/targets.ts';
const db = await targetFromEnvironment(process.env);
try {
  const source = '4d1ebe80-779e-4c7f-9e30-80a47c8af886';
  for (const [name, sql] of Object.entries({
    workflow: `select w.*,e.status as event_status from public.upload_workflows w join public.shift_events e on e.id=w.event_id where e.source_id='${source}' order by e.created_at desc limit 1`,
    steps: `select split_part(key,':',1) stage,state,count(*) batches,max(attempts) max_attempts,max(updated_at) updated_at from public.upload_steps where event_id in (select id from public.shift_events where source_id='${source}') group by 1,2`,
    calls: `select created_at,purpose,model,duration_ms,status,left(error,180) error,prompt_tokens,completion_tokens from public.ai_calls where created_at>now()-interval '30 minutes' order by created_at desc limit 5`,
    knowledge: `select count(*) saved_units,coalesce(sum(cardinality(r.passage_ids)),0) citation_references,
      count(*) filter(where cardinality(r.passage_ids)=0 or exists(select 1 from unnest(r.passage_ids) ref where not exists(select 1 from public.passages p where p.id=ref))) invalid_citations
      from public.units u join public.revisions r on r.id=u.current_revision_id where u.space_id='21132c80-32b3-4ef2-9156-d9af60486173'
      and u.retired_at is null and exists(select 1 from public.passages p where p.id=any(r.passage_ids) and p.source_id='${source}')`,
    locks: `select a.pid,a.wait_event_type,a.wait_event,extract(epoch from now()-a.query_start) seconds,left(a.query,180) query,
      (select jsonb_agg(jsonb_build_object('pid',b.pid,'state',b.state,'seconds',extract(epoch from now()-b.query_start),'query',left(b.query,700)))
        from pg_stat_activity b where b.pid=any(pg_blocking_pids(a.pid))) blockers
      from pg_stat_activity a where a.state='active' and a.pid<>pg_backend_pid() and a.wait_event_type='Lock'
      and a.query ilike '%upload_workflow_write%'`,
  })) console.log(name, JSON.stringify(await db.query(sql)));
} finally { await db.close(); }
