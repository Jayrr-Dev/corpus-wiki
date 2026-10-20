import { connectPostgres } from "../scripts/db/targets.ts";

const url = process.env.SUPABASE_DB_URL;
if (!url) throw new Error("SUPABASE_DB_URL missing");
const db = await connectPostgres(url);
const rows = await db.query(`
  select created_at, purpose, model, reasoning_effort, prompt_tokens, completion_tokens, duration_ms, status, left(coalesce(error, ''), 300) as error
  from public.ai_calls
  where purpose in ('domain_decision', 'domain_structure_review')
     or coalesce(error, '') ilike '%no new output%'
  order by created_at desc
  limit 20
`);
console.log(JSON.stringify(rows, null, 2));
await db.close();
