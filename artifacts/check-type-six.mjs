import { targetFromEnvironment } from "../scripts/db/targets.ts";

const db = await targetFromEnvironment(process.env);
const rows = await db.query(`
select status, attempts, left(coalesce(note, ''), 200) as note, lease_until, signals->'progress' as progress
from article_suggestions
where title = 'Type Six (Loyalist)'
`);
const sections = await db.query(`
select s.title, s.status, s.position,
  (select count(*)::int from lines l where l.section_id = s.id and l.retired_at is null) as lines
from sections s join pages p on p.id = s.page_id
where p.title = 'Type Six (Loyalist)' and s.retired_at is null and p.retired_at is null
order by s.position
`);
console.log(JSON.stringify({ rows, sections }, null, 2));
await db.close();
