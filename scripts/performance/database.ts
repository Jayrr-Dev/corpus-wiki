import { mkdir, writeFile } from "node:fs/promises";
import { targetFromEnvironment } from "../db/targets.ts";

// Read-only aggregate diagnostics. No source text, names, secrets or canonical writes.
const target = await targetFromEnvironment(process.env);
try {
  const size = await target.query("select current_setting('default_table_access_method') as access_method, (select count(*) from public.sources) as sources, (select count(*) from public.units where retired_at is null) as live_units, (select count(*) from public.lines where retired_at is null) as live_lines, (select count(*) from public.pages where retired_at is null) as live_pages");
  const calls = await target.query("select purpose, count(*)::int as calls, round(avg(duration_ms)) as average_ms, sum(duration_ms) as total_ms, count(*) filter (where status <> 'ok')::int as failures from public.ai_calls where created_at > now() - interval '7 days' group by purpose order by sum(duration_ms) desc");
  const recent = await target.query("select purpose, reasoning_effort, status, count(*)::int as calls, round(avg(duration_ms)) as average_ms from public.ai_calls where created_at > now() - interval '1 day' and purpose in ('reconciliation','glossary_dictionary','section_lines','page_editorial_review') group by purpose,reasoning_effort,status order by purpose,reasoning_effort,status");
  const workflows = await target.query("select state, cancel_requested, count(*)::int as runs, count(*) filter(where state='running' and lease_until<now())::int as expired from public.upload_workflows group by state,cancel_requested");
  const stalePlan = await target.query("set statement_timeout='5s'; explain (analyze, buffers, format json) select count(*) from public.stale_lines");
  await mkdir("artifacts/processing", { recursive: true });
  await writeFile("artifacts/processing/database-baseline.json", JSON.stringify({ generatedAt: new Date().toISOString(), size, calls, recent, workflows, stalePlan }, null, 2) + "\n");
  console.log(JSON.stringify({ size, topCalls: calls.slice(0, 4), recent, workflows }, null, 2));
} finally { await target.close(); }
