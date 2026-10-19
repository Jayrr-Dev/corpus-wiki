import { targetFromEnvironment } from "../scripts/db/targets.ts";

const db = await targetFromEnvironment(process.env);
const started = Date.now();
const rows = await db.query(`
select jsonb_array_length(public.missing_glossary_embeddings('Qwen/Qwen3-Embedding-8B', 64)) as batch
from (
  select set_config('request.headers', '{"x-space-id":"21132c80-32b3-4ef2-9156-d9af60486173"}', true),
         set_config('request.jwt.claims', '{"role":"service_role"}', true)
) configured
`);
console.log(JSON.stringify({ ms: Date.now() - started, rows }));
await db.close();
