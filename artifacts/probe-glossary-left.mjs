import { targetFromEnvironment } from "../scripts/db/targets.ts";

const db = await targetFromEnvironment(process.env);
const rows = await db.query(`select count(*)::int as leftover from public.glossary_embeddings where model = 'probe-model'`);
console.log(JSON.stringify(rows));
await db.close();
