import { targetFromEnvironment } from "../scripts/db/targets.ts";

const db = await targetFromEnvironment(process.env);
const before = await db.query(
  `select status, count(*)::int as n from article_suggestions group by status order by status`,
);
const removed = await db.query(`
with deleted as (
  delete from article_suggestions returning id
)
select count(*)::int as removed from deleted
`);
const after = await db.query(
  `select count(*)::int as n from article_suggestions`,
);
console.log(JSON.stringify({ before, removed, after }, null, 2));
await db.close();
