import { targetFromEnvironment } from "../scripts/db/targets.ts";

const db = await targetFromEnvironment(process.env);
const runs = await db.query(`
select id, state, total, suggested, done, created_at,
  (select count(*)::int from article_suggestions s where s.run_id = suggestion_runs.id) as rows,
  (select coalesce(sum(cardinality(unit_ids)), 0)::int from article_suggestions s where s.run_id = suggestion_runs.id) as units
from suggestion_runs
order by created_at desc
limit 8
`);
const open = await db.query(`
select count(*)::int as suggestions,
  coalesce(sum(cardinality(unit_ids)), 0)::int as unit_slots,
  count(distinct u)::int as units
from article_suggestions
cross join lateral unnest(unit_ids) u
where status in ('pending','accepting','failed','stale')
`);
console.log(JSON.stringify({ runs, open }, null, 2));
await db.close();
