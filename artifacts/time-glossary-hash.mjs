import { targetFromEnvironment } from "../scripts/db/targets.ts";

const db = await targetFromEnvironment(process.env);
const started = Date.now();
const rows = await db.query(`
select count(*)::int as entries
from public.glossary_state s
cross join lateral jsonb_array_elements(s.entries) e
where s.space_id = '21132c80-32b3-4ef2-9156-d9af60486173'
  and public.glossary_embedding_key(e.value) is not null
`);
console.log(JSON.stringify({ ms: Date.now() - started, rows }));
await db.close();
