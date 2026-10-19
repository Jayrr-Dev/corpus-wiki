import { targetFromEnvironment } from "../scripts/db/targets.ts";

const db = await targetFromEnvironment(process.env);
const before = await db.query(`
select space_id, jsonb_array_length(entries)::int as entries
from public.glossary_state
where id
order by space_id
`);
let probe;
try {
  probe = await db.query(`
do $probe$
declare
  entries jsonb;
  rows jsonb;
  vector jsonb;
  saved integer;
  total integer;
begin
  select coalesce(jsonb_agg(e.value), '[]') into entries
  from (
    select e.value
    from public.glossary_state s
    cross join lateral jsonb_array_elements(s.entries) e
    where s.id and s.space_id = '00000000-0000-4000-8000-000000000001'
    limit 2
  ) e;
  if jsonb_array_length(entries) < 2 then
    raise exception 'PROBE_FAIL not enough entries';
  end if;
  select jsonb_agg(0.01) into vector from generate_series(1, 1024);
  select jsonb_agg(jsonb_build_object(
    'hash', 'probe-' || ordinality::text,
    'model', 'probe-model',
    'entry', value,
    'embedding', vector
  )) into rows
  from jsonb_array_elements(entries) with ordinality;
  saved := public.save_glossary_embeddings(rows);
  select count(*) into total from public.glossary_embeddings where model = 'probe-model';
  raise exception 'PROBE_OK saved=% total=%', saved, total;
end
$probe$;
`);
} catch (error) {
  probe = error instanceof Error ? error.message : String(error);
}
console.log(JSON.stringify({ before, probe }, null, 2));
await db.close();
