import { targetFromEnvironment } from "../scripts/db/targets.ts";

const db = await targetFromEnvironment(process.env);
const rows = await db.query(`
select status, title, left(coalesce(note, ''), 140) as note, attempts, lease_until
from article_suggestions
where status in ('accepting', 'failed', 'stale')
order by status, decided_at desc nulls last
`);
console.log(JSON.stringify(rows, null, 2));
await db.close();
