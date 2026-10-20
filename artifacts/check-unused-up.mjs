import { targetFromEnvironment } from "../scripts/db/targets.ts";

const db = await targetFromEnvironment(process.env);
const rows = await db.query(`
select
  (select count(*)::int from units u where u.retired_at is null) as units,
  (select used_unit_count from knowledge_usage) as used,
  (select count(*)::int from article_suggestions where status in ('pending','accepting','failed','stale')) as open_rows,
  (select count(distinct id)::int from (
     select unnest(unit_ids) id from article_suggestions where status in ('pending','accepting','failed','stale')
  ) s) as held,
  (select count(*)::int from article_suggestions where status = 'applied') as applied,
  (select count(*)::int from article_suggestions where status = 'dismissed') as dismissed
`);
const pages = await db.query(`
select p.title, p.article_type, p.retired_at is not null as retired,
  s.title as section, s.mode, s.status,
  case when jsonb_typeof(s.query->'unitIds') = 'array' then jsonb_array_length(s.query->'unitIds') else null end as listed,
  (select count(*)::int from section_inputs si where si.section_id = s.id) as cited
from pages p
left join sections s on s.page_id = p.id and s.retired_at is null
where p.title in ('Obsessive-compulsive personality disorder', 'Histrionic personality disorder')
order by p.title, s.position
`);
const released = await db.query(`
with applied_units as (
  select a.id suggestion_id, a.title, a.kind, a.note, u.unit_id
  from article_suggestions a
  cross join lateral unnest(a.unit_ids) u(unit_id)
  where a.status = 'applied'
)
select count(*)::int as applied_units,
  count(*) filter (where not exists (select 1 from section_knowledge sk where sk.unit_id = applied_units.unit_id))::int as still_unused
from applied_units
`);
console.log(JSON.stringify({ rows, released, pages }, null, 2));
await db.close();
