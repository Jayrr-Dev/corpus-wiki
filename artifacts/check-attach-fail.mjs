import { targetFromEnvironment } from "../scripts/db/targets.ts";

const db = await targetFromEnvironment(process.env);
const actions = await db.query(`
select a.outcome, a.check_results, a.target_id, s.title, s.mode, s.retired_at is not null as section_retired, s.query
from actions a
left join sections s on s.id = a.target_id
where a.type = 'update_section_query'
  and a.created_at > now() - interval '2 hours'
  and a.outcome = 'rejected'
order by a.created_at desc
limit 8
`);
console.log(JSON.stringify(actions, null, 2));
await db.close();
