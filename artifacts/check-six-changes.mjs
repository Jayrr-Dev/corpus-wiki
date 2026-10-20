import { targetFromEnvironment } from "../scripts/db/targets.ts";

const db = await targetFromEnvironment(process.env);
const rows = await db.query(`
select cs.created_at, cs.status, left(cs.summary, 90) as summary, cs.prompt_version,
  (select json_agg(json_build_object('type', a.type, 'outcome', a.outcome, 'reverted', a.reverted_by_event_id is not null, 'checks', a.check_results)) from actions a where a.change_set_id = cs.id) as actions
from change_sets cs
where cs.created_at > now() - interval '90 minutes'
  and cs.prompt_version like 'article-scaffold%'
order by cs.created_at desc
limit 20
`);
console.log(JSON.stringify(rows, null, 2));
await db.close();
