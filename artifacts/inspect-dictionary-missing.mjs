import { targetFromEnvironment } from "../scripts/db/targets.ts";

const db = await targetFromEnvironment(process.env);
const missing = await db.query(`
select s.space_id,
  count(*)::int as entries,
  count(*) filter (where exists (
    select 1 from public.glossary_embeddings v
    where v.space_id = s.space_id and v.model = 'Qwen/Qwen3-Embedding-8B' and v.entry = e.value
  ))::int as embedded
from public.glossary_state s
cross join lateral jsonb_array_elements(s.entries) e
where s.id
group by s.space_id
`);
const conns = await db.query(`
select count(*)::int as total,
  count(*) filter (where state = 'active')::int as active,
  count(*) filter (where wait_event_type is not null)::int as waiting
from pg_stat_activity
where datname = current_database()
`);
console.log(JSON.stringify({ missing, conns }, null, 2));
await db.close();
