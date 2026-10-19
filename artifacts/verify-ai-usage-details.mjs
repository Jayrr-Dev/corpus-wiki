import { targetFromEnvironment } from "../scripts/db/targets.ts";
const db = await targetFromEnvironment(process.env);
try {
  await db.query(`begin;
    select set_config('request.headers','{"x-space-id":"21132c80-32b3-4ef2-9156-d9af60486173"}',true);
    set local role space_runtime;
    select public.log_ai_call('{"purpose":"cost_estimate_verification","subject":"Rollback-only billing check","model":"anthropic/claude-opus-5-5","reasoningEffort":"low","promptTokens":10000,"completionTokens":50,"reasoningTokens":null,"durationMs":1,"status":"ok","error":null,"usageDetails":{"prompt_tokens":10000,"completion_tokens":50,"cache_read_input_tokens":6000,"cache_creation_input_tokens":3000,"cache_creation":{"ephemeral_5m_input_tokens":2000,"ephemeral_1h_input_tokens":1000}}}'::jsonb);
    do $$ begin
      if not exists(select 1 from public.ai_calls where purpose='cost_estimate_verification'
        and space_id='21132c80-32b3-4ef2-9156-d9af60486173' and usage_details->>'cache_read_input_tokens'='6000'
        and usage_details->'cache_creation'->>'ephemeral_1h_input_tokens'='1000') then
        raise exception 'Billing usage details were not saved in the intended space';
      end if;
    end $$;
    rollback;`);
  console.log("Live billing-log check passed: cache usage persisted in the selected space; test transaction rolled back.");
  const rows = await db.query(`select model,count(*) calls,count(*) filter(where prompt_tokens>100000) long_prompts,
    sum(prompt_tokens) input,sum(completion_tokens) output,
    count(*) filter(where prompt_tokens is null or completion_tokens is null) missing_usage
    from public.ai_calls where created_at>=date_trunc('month',now() at time zone 'UTC') group by model order by calls desc`);
  console.log(JSON.stringify(rows));
} finally { await db.close(); }
