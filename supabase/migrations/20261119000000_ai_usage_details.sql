-- Preserve cache reads and write durations for request-level cost estimates.
-- Historical rows stay null: their lost cache breakdown cannot be reconstructed.
alter table public.ai_calls add column usage_details jsonb;

create or replace function public.log_ai_call(p_call jsonb)
returns void language sql set search_path='' as $$
  insert into public.ai_calls(purpose,subject,model,reasoning_effort,prompt_tokens,completion_tokens,
    reasoning_tokens,duration_ms,status,error,role,usage_details)
  values(p_call->>'purpose',p_call->>'subject',p_call->>'model',p_call->>'reasoningEffort',
    (p_call->>'promptTokens')::integer,(p_call->>'completionTokens')::integer,
    (p_call->>'reasoningTokens')::integer,(p_call->>'durationMs')::integer,
    p_call->>'status',p_call->>'error',p_call->>'role',nullif(p_call->'usageDetails','null'::jsonb));
$$;
notify pgrst,'reload schema';
