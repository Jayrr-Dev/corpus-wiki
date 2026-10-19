import { targetFromEnvironment } from "../scripts/db/targets.ts";

const db = await targetFromEnvironment(process.env);
const rows = await db.query(`
select sp.name as space_name,
  count(*)::int as entries,
  count(*) filter (where not exists (
    select 1 from public.glossary_embeddings v
    where v.space_id = s.space_id
      and v.model = 'Qwen/Qwen3-Embedding-8B'
      and v.content_key = public.glossary_embedding_key(e.value)
  ))::int as missing_vectors,
  (select count(*)::int from public.glossary_embeddings g where g.space_id = s.space_id and g.content_key is null) as unkeyed
from public.glossary_state s
join public.spaces sp on sp.id = s.space_id
cross join lateral jsonb_array_elements(s.entries) e
where s.id
group by sp.name, s.space_id
order by sp.name
`);
console.log(JSON.stringify(rows, null, 2));
await db.close();
