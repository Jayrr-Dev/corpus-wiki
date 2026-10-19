import { targetFromEnvironment } from "../scripts/db/targets.ts";

const db = await targetFromEnvironment(process.env);
const started = Date.now();
let probe;
try {
  probe = await db.query(`
do $probe$
declare started timestamptz := clock_timestamp(); result jsonb;
begin
  perform set_config('statement_timeout', '8s', true);
  perform set_config('request.headers', '{"x-space-id":"21132c80-32b3-4ef2-9156-d9af60486173"}', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select public.curator_snapshot() into result;
  raise exception 'PROBE_OK pages=% claims=% unplaced=% vectors=% ms=%',
    jsonb_array_length(result->'pages'),
    jsonb_array_length(result->'claims'),
    jsonb_array_length(result->'unplaced'),
    jsonb_array_length(result->'vectors'),
    round(extract(milliseconds from clock_timestamp() - started));
end
$probe$;
`);
} catch (error) {
  probe = error instanceof Error ? error.message : String(error);
}
console.log(JSON.stringify({ ms: Date.now() - started, probe }));
await db.close();
