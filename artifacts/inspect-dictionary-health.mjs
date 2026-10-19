import { targetFromEnvironment } from "../scripts/db/targets.ts";

const db = await targetFromEnvironment(process.env);
const health = await db.query(`select now() as db_time, count(*)::int as backends from pg_stat_activity where datname = current_database()`);
console.log(JSON.stringify(health));
await db.close();
