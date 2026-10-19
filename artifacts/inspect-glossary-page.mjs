import { targetFromEnvironment } from "../scripts/db/targets.ts";

const db = await targetFromEnvironment(process.env);
const state = await db.query(`
select s.space_id, sp.name as space_name, s.status,
  jsonb_array_length(s.entries)::int as entries,
  jsonb_array_length(s.pending_entries)::int as pending,
  jsonb_array_length(s.live_entries)::int as live_entries,
  s.completed_batches, s.total_batches,
  s.generated_at, s.lease_until, left(coalesce(s.error, ''), 240) as error
from public.glossary_state s
join public.spaces sp on sp.id = s.space_id
where s.id
order by sp.name
`);
const embeddings = await db.query(`
select space_id, count(*)::int as vectors
from public.glossary_embeddings
where model = 'Qwen/Qwen3-Embedding-8B'
group by space_id
`);
const step = await db.query(`
select state, attempts, left(coalesce(error, ''), 240) as error, updated_at
from public.upload_steps
where key = 'glossary'
order by updated_at desc
limit 1
`);
console.log(JSON.stringify({ state, embeddings, step }, null, 2));
await db.close();
