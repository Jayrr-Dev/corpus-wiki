import { targetFromEnvironment } from "../scripts/db/targets.ts";

const db = await targetFromEnvironment(process.env);
const sample = await db.query(`
select sp.name as space_name,
  e.value->>'term' as term,
  left(e.value->>'definition', 120) as definition,
  jsonb_array_length(coalesce(e.value->'citations', '[]'::jsonb))::int as citations
from public.glossary_state s
join public.spaces sp on sp.id = s.space_id
cross join lateral jsonb_array_elements(s.entries) with ordinality e(value, n)
where s.id and e.n <= 3
order by sp.name, e.n
`);
const shape = await db.query(`
select sp.name as space_name,
  count(*)::int as entries,
  count(*) filter (where coalesce(e.value->>'term','') = '')::int as blank_terms,
  count(*) filter (where coalesce(e.value->>'definition','') = '')::int as blank_definitions,
  count(*) filter (where e.value->>'meaningId' is null)::int as missing_ids
from public.glossary_state s
join public.spaces sp on sp.id = s.space_id
cross join lateral jsonb_array_elements(s.entries) e
where s.id
group by sp.name
order by sp.name
`);
console.log(JSON.stringify({ shape, sample }, null, 2));
await db.close();
