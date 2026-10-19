import { targetFromEnvironment } from "../scripts/db/targets.ts";

const db = await targetFromEnvironment(process.env);
let probe;
try {
  probe = await db.query(`
do $probe$
declare entries jsonb; payload jsonb; vector jsonb; saved integer;
begin
  perform set_config('request.headers', '{"x-space-id":"21132c80-32b3-4ef2-9156-d9af60486173"}', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  if to_regclass('public.glossary_embeddings_content_idx') is not null then
    raise exception 'PROBE_FAIL index still present';
  end if;
  select coalesce(jsonb_agg(e.value), '[]') into entries
  from (
    select e.value
    from public.glossary_state s
    cross join lateral jsonb_array_elements(s.entries) e
    where s.id and s.space_id = '21132c80-32b3-4ef2-9156-d9af60486173'
    limit 2
  ) e;
  select jsonb_agg(0.01) into vector from generate_series(1, 1024);
  select jsonb_agg(jsonb_build_object(
    'hash', 'probe-content-' || ordinality::text,
    'model', 'probe-model',
    'entry', value,
    'embedding', vector
  )) into payload
  from jsonb_array_elements(entries) with ordinality;
  saved := public.save_glossary_embeddings(payload);
  raise exception 'PROBE_OK saved=%', saved;
end
$probe$;
`);
} catch (error) {
  probe = error instanceof Error ? error.message : String(error);
}
console.log(probe);
await db.close();
