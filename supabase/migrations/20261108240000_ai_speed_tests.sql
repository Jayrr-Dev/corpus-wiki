-- =====================================================================
-- SECOND BRAIN · AI SPEED TESTS
-- =====================================================================
-- One row per run of the live speed test on /settings (AI Speed): a short
-- streamed answer from one model at one reasoning effort, timed on the
-- server. latency_ms is the wait for the first token; tokens_per_second
-- is the output rate after it. A failed run keeps its error and no numbers.
-- Server code writes and reads it through the functions below (service_role only).
-- =====================================================================

create table public.ai_speed_tests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  model text not null,
  effort text not null check (effort in ('low', 'medium', 'off')),  -- 'off': thinking turned off (Nemotron 3)
  latency_ms integer,
  total_ms integer,
  tokens_out integer,
  tokens_per_second double precision,
  estimated boolean not null default false,  -- tokens_out counted from the text (the provider sent no usage)
  status text not null check (status in ('ok', 'error')),
  error text
);
comment on table public.ai_speed_tests is 'One row per AI speed test run on /settings: model, effort, latency, tokens per second.';
create index ai_speed_tests_model_created_idx on public.ai_speed_tests (model, created_at desc);

alter table public.ai_speed_tests enable row level security;
revoke all on public.ai_speed_tests from anon, authenticated;

-- WRITE ONE RUN: p_test = { model, effort, latencyMs, totalMs, tokensOut, tokensPerSecond, estimated, status, error }
create function public.record_ai_speed_test(p_test jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into public.ai_speed_tests (model, effort, latency_ms, total_ms, tokens_out, tokens_per_second, estimated, status, error)
  values (p_test ->> 'model', p_test ->> 'effort', (p_test ->> 'latencyMs')::integer, (p_test ->> 'totalMs')::integer,
          (p_test ->> 'tokensOut')::integer, (p_test ->> 'tokensPerSecond')::double precision,
          coalesce((p_test ->> 'estimated')::boolean, false), p_test ->> 'status', p_test ->> 'error');
$$;

-- READ: each model's latest run, plus how many runs it has had
create function public.get_latest_ai_speed_tests()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'model', t.model, 'effort', t.effort, 'latencyMs', t.latency_ms, 'totalMs', t.total_ms,
    'tokensOut', t.tokens_out, 'tokensPerSecond', t.tokens_per_second, 'estimated', t.estimated,
    'status', t.status, 'error', t.error, 'testedAt', t.created_at, 'runs', t.runs
  )), '[]'::jsonb)
  from (
    select distinct on (s.model) s.*, count(*) over (partition by s.model) as runs
    from public.ai_speed_tests s
    order by s.model, s.created_at desc
  ) t;
$$;

revoke execute on function public.record_ai_speed_test(jsonb) from public, anon, authenticated;
grant execute on function public.record_ai_speed_test(jsonb) to service_role;
revoke execute on function public.get_latest_ai_speed_tests() from public, anon, authenticated;
grant execute on function public.get_latest_ai_speed_tests() to service_role;
