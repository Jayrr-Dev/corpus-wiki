import { targetFromEnvironment } from "../scripts/db/targets.ts";

const db = await targetFromEnvironment(process.env);
const runs = await db.query(`
select id, state, phase, total, done, suggested, error, created_at, started_at, lease_until
from suggestion_runs
order by created_at desc
limit 3
`);
console.log(JSON.stringify(runs, null, 2));
await db.close();
