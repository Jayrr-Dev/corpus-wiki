-- =====================================================================
-- SECOND BRAIN · AI CALL LOG (token usage)
-- =====================================================================
-- One row per call to the AI provider, so the person can see what each
-- upload and page rebuild cost: model, tokens in / out / spent reasoning,
-- how long it took, and whether it worked. Server code writes it through
-- log_ai_call (service_role only); the signed-in user reads it on /settings.
-- =====================================================================

create table public.ai_calls (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  purpose text not null,                     -- what the call was for: 'reconciliation', 'section_lines'
  subject text,                              -- which file or section, in words
  model text not null,
  reasoning_effort text,                     -- the effort asked for ('medium', 'low')
  prompt_tokens integer,
  completion_tokens integer,                 -- includes reasoning tokens
  reasoning_tokens integer,
  duration_ms integer not null,
  status text not null check (status in ('ok', 'cut_off', 'error')),
  error text
);
comment on table public.ai_calls is 'One row per AI provider call: model, token usage, duration and outcome.';
create index ai_calls_created_idx on public.ai_calls (created_at desc);

alter table public.ai_calls enable row level security;
revoke all on public.ai_calls from anon, authenticated;
grant select on public.ai_calls to authenticated;
create policy ai_calls_read on public.ai_calls for select to authenticated using (true);

-- WRITE ONE CALL: p_call = { purpose, subject, model, reasoningEffort, promptTokens,
-- completionTokens, reasoningTokens, durationMs, status, error }
create function public.log_ai_call(p_call jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into public.ai_calls (purpose, subject, model, reasoning_effort, prompt_tokens, completion_tokens,
                               reasoning_tokens, duration_ms, status, error)
  values (p_call ->> 'purpose', p_call ->> 'subject', p_call ->> 'model', p_call ->> 'reasoningEffort',
          (p_call ->> 'promptTokens')::integer, (p_call ->> 'completionTokens')::integer,
          (p_call ->> 'reasoningTokens')::integer, (p_call ->> 'durationMs')::integer,
          p_call ->> 'status', p_call ->> 'error');
$$;

revoke execute on function public.log_ai_call(jsonb) from public, anon, authenticated;
grant execute on function public.log_ai_call(jsonb) to service_role;
