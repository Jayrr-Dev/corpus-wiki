-- =====================================================================
-- SECOND BRAIN · BILLING (plans, subscriptions, usage windows)
-- =====================================================================
-- v1 of docs/monetization-plan.md. Behind the `billing` feature flag; the
-- workspace monetization switch decides whether limits are enforced.
--
-- 1. plans            the price list (lib/billing/plans.ts seeds the same)
-- 2. subscriptions    one row per person, kept in step by the Stripe webhook
-- 3. usage_windows    credits used per 5-hour session and per week
-- 4. ai_calls         billed_user_id and credits on every call
-- 5. RPCs             check_and_reserve_usage (atomic), settle_usage,
--                     get_billing_account, link_stripe_customer, sync_subscription
--
-- These are account records, not space content: no space_id. Nobody reads
-- or writes the tables directly (RLS on, no policies); the functions are
-- SECURITY DEFINER and keep the migration role as owner, like feature_flags.
-- B-tree indexes only (OrioleDB).
-- 1 credit = $0.001 of estimateCallCost (lib/ai/pricing.ts).
-- =====================================================================

-- 1. PLANS -------------------------------------------------------------
create table public.plans (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{0,31}$'),
  name text not null,
  monthly_usd numeric(10,2) not null check (monthly_usd >= 0),
  yearly_usd numeric(10,2) check (yearly_usd >= 0),
  per_seat boolean not null default false,
  seat_minimum integer not null default 1 check (seat_minimum >= 1),
  weekly_credits numeric(14,3) not null check (weekly_credits >= 0),
  -- null: no separate 5-hour limit (Team draws from its weekly pool)
  session_credits numeric(14,3) check (session_credits >= 0),
  features jsonb not null default '{}'::jsonb,
  model_caps jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0
);
comment on table public.plans is 'Price list; keep in step with lib/billing/plans.ts. 1 credit = $0.001 of estimateCallCost.';

insert into public.plans (id, name, monthly_usd, yearly_usd, per_seat, seat_minimum, weekly_credits, session_credits, features, sort_order) values
  ('free', 'Free', 0,  null, false, 1,   300,  100, '{"spaces": 1, "models": "small", "background_agents": false}', 0),
  ('plus', 'Plus', 9,  90,   false, 1,  2500,  800, '{}', 1),
  ('pro',  'Pro',  24, 240,  false, 1,  7500, 2500, '{"models": "all", "mcp": true, "publishing": true, "connectors": true}', 2),
  ('max',  'Max',  79, null, false, 1, 25000, 8000, '{"models": "all", "mcp": true, "publishing": true, "connectors": true, "priority_queue": true}', 3),
  ('team', 'Team', 15, null, true,  3,  5000, null, '{"pooled": true}', 4);

-- 2. SUBSCRIPTIONS -----------------------------------------------------
create table public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_id text not null default 'free' references public.plans(id),
  status text not null default 'active'
    check (status in ('active', 'trialing', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused')),
  seats integer not null default 1 check (seats >= 1),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  period_start timestamptz,
  period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  -- The Stripe event last applied; an older one arriving late is ignored
  stripe_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.subscriptions is 'One plan per person; written by the Stripe webhook through sync_subscription.';

-- 3. USAGE WINDOWS -----------------------------------------------------
create table public.usage_windows (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('session', 'weekly')),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  credits_used numeric(14,3) not null default 0 check (credits_used >= 0),
  primary key (user_id, kind, starts_at)
);
comment on table public.usage_windows is 'Credits used per person in each 5-hour session and each week.';
create index usage_windows_open_idx on public.usage_windows (user_id, kind, ends_at);

alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.usage_windows enable row level security;
revoke all on public.plans, public.subscriptions, public.usage_windows from public, anon, authenticated;

-- 4. ATTRIBUTION AND CREDITS ON ai_calls ------------------------------
alter table public.ai_calls
  add column billed_user_id uuid references auth.users(id) on delete set null,
  add column credits numeric(14,3);
create index ai_calls_billed_user_idx on public.ai_calls (billed_user_id, created_at);

-- The person a space's AI use bills: its owner (background work included)
create function public.space_billed_user(p_space uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.owner_id from public.spaces s where s.id = p_space;
$$;

grant create on schema public to space_runtime;

-- Same as before, plus who pays and the credits fixed at write time
create or replace function public.log_ai_call(p_call jsonb)
returns void language sql set search_path='' as $$
  insert into public.ai_calls(purpose,subject,model,reasoning_effort,prompt_tokens,completion_tokens,
    reasoning_tokens,duration_ms,status,error,role,usage_details,billed_user_id,credits)
  values(p_call->>'purpose',p_call->>'subject',p_call->>'model',p_call->>'reasoningEffort',
    (p_call->>'promptTokens')::integer,(p_call->>'completionTokens')::integer,
    (p_call->>'reasoningTokens')::integer,(p_call->>'durationMs')::integer,
    p_call->>'status',p_call->>'error',p_call->>'role',nullif(p_call->'usageDetails','null'::jsonb),
    coalesce(nullif(p_call->>'billedUserId','')::uuid, public.space_billed_user(public.current_space_id())),
    (p_call->>'credits')::numeric);
$$;

revoke create on schema public from space_runtime;

-- 5. RPCs --------------------------------------------------------------

-- The plan a person is on now: a live paid subscription, else Free
create function public.current_plan_for(p_user uuid)
returns table (plan_id text, seats integer, anchor timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(live.plan_id, 'free'),
         coalesce(live.seats, 1),
         coalesce(live.period_start, live.created_at, u.created_at, now())
  from auth.users u
  left join public.subscriptions live
    on live.user_id = u.id and live.status in ('active', 'trialing', 'past_due')
  where u.id = p_user;
$$;

-- THE GATE: reserves p_credits for one AI call, atomically.
-- A per-person transaction lock serializes reservations, so two parallel
-- jobs can never both take the last credits. The session window opens on
-- the first call after the last one closed and lasts 5 hours; the weekly
-- window is anchored to the plan start and repeats every 7 days.
-- With p_enforce = false (monetization switch off) the credits are always
-- counted and the call always passes; `reason` still says which limit it
-- would have hit, for the log.
create function public.check_and_reserve_usage(p_user uuid, p_credits numeric, p_enforce boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  person uuid := coalesce(p_user, public.space_billed_user(public.current_space_id()));
  cost numeric := greatest(coalesce(p_credits, 0), 0);
  chosen record;
  plan public.plans%rowtype;
  session_limit numeric;
  weekly_limit numeric;
  session_row public.usage_windows%rowtype;
  weekly_row public.usage_windows%rowtype;
  week_anchor timestamptz;
  week_start timestamptz;
  reason text;
  resets timestamptz;
  allowed boolean;
begin
  if person is null then
    return jsonb_build_object('ok', true, 'reason', null, 'resetsAt', null, 'reserved', 0,
      'sessionStartsAt', null, 'weeklyStartsAt', null, 'userId', null);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('usage:' || person::text, 0));

  select * into chosen from public.current_plan_for(person);
  select * into plan from public.plans where id = coalesce(chosen.plan_id, 'free');
  weekly_limit := plan.weekly_credits * (case when plan.per_seat then greatest(coalesce(chosen.seats, 1), plan.seat_minimum) else 1 end);
  session_limit := coalesce(plan.session_credits, weekly_limit);

  -- This week's window
  week_anchor := least(coalesce(chosen.anchor, now()), now());
  week_start := week_anchor + floor(extract(epoch from (now() - week_anchor)) / 604800) * interval '7 days';
  select * into weekly_row from public.usage_windows
    where user_id = person and kind = 'weekly' and starts_at = week_start;
  if not found then
    insert into public.usage_windows (user_id, kind, starts_at, ends_at)
      values (person, 'weekly', week_start, week_start + interval '7 days')
      returning * into weekly_row;
  end if;

  -- The open session, or a new one from now
  select * into session_row from public.usage_windows
    where user_id = person and kind = 'session' and ends_at > now()
    order by starts_at desc limit 1;
  if not found then
    insert into public.usage_windows (user_id, kind, starts_at, ends_at)
      values (person, 'session', now(), now() + interval '5 hours')
      returning * into session_row;
  end if;

  if session_row.credits_used + cost > session_limit then
    reason := 'session_limit';
    resets := session_row.ends_at;
  elsif weekly_row.credits_used + cost > weekly_limit then
    reason := 'weekly_limit';
    resets := weekly_row.ends_at;
  end if;

  allowed := reason is null or not coalesce(p_enforce, true);
  if allowed then
    update public.usage_windows set credits_used = credits_used + cost
      where user_id = person and kind = 'session' and starts_at = session_row.starts_at;
    update public.usage_windows set credits_used = credits_used + cost
      where user_id = person and kind = 'weekly' and starts_at = weekly_row.starts_at;
  end if;

  return jsonb_build_object(
    'ok', allowed,
    'reason', reason,
    'resetsAt', resets,
    'reserved', case when allowed then cost else 0 end,
    'planId', plan.id,
    'sessionStartsAt', session_row.starts_at,
    'weeklyStartsAt', weekly_row.starts_at,
    'sessionUsed', session_row.credits_used + case when allowed then cost else 0 end,
    'sessionLimit', session_limit,
    'weeklyUsed', weekly_row.credits_used + case when allowed then cost else 0 end,
    'weeklyLimit', weekly_limit,
    'userId', person
  );
end $$;

-- After the call: moves the reservation to the real cost (p_delta = actual - reserved)
create function public.settle_usage(p_user uuid, p_session_starts timestamptz, p_weekly_starts timestamptz, p_delta numeric)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.usage_windows
    set credits_used = greatest(0, credits_used + coalesce(p_delta, 0))
    where user_id = p_user
      and ((kind = 'session' and starts_at = p_session_starts) or (kind = 'weekly' and starts_at = p_weekly_starts));
$$;

-- Plan, status and Stripe customer for the billing actions
create function public.get_billing_account(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'planId', coalesce((select c.plan_id from public.current_plan_for(p_user) c), 'free'),
    'status', coalesce(s.status, 'active'),
    'customerId', s.stripe_customer_id
  )
  from (select 1) anchor
  left join public.subscriptions s on s.user_id = p_user;
$$;

-- Checkout finished: remember the person's Stripe customer
create function public.link_stripe_customer(p_user uuid, p_customer text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.subscriptions (user_id, stripe_customer_id)
  values (p_user, p_customer)
  on conflict (user_id) do update
    set stripe_customer_id = excluded.stripe_customer_id, updated_at = now();
$$;

-- A subscription event from Stripe; the person comes from its metadata or the linked customer
create function public.sync_subscription(p_subscription jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  person uuid := nullif(p_subscription->>'userId', '')::uuid;
  event_at timestamptz := (p_subscription->>'eventAt')::timestamptz;
begin
  if person is null then
    select s.user_id into person from public.subscriptions s
      where s.stripe_customer_id = p_subscription->>'customerId';
  end if;
  if person is null then
    raise exception 'No person for Stripe customer %', p_subscription->>'customerId';
  end if;
  insert into public.subscriptions as s (user_id, plan_id, status, seats, stripe_customer_id, stripe_subscription_id,
      period_start, period_end, cancel_at_period_end, stripe_event_at, updated_at)
  values (person, p_subscription->>'planId', p_subscription->>'status', greatest(coalesce((p_subscription->>'seats')::integer, 1), 1),
      p_subscription->>'customerId', p_subscription->>'subscriptionId',
      (p_subscription->>'periodStart')::timestamptz, (p_subscription->>'periodEnd')::timestamptz,
      coalesce((p_subscription->>'cancelAtPeriodEnd')::boolean, false), event_at, now())
  on conflict (user_id) do update
    set plan_id = excluded.plan_id, status = excluded.status, seats = excluded.seats,
        stripe_customer_id = excluded.stripe_customer_id, stripe_subscription_id = excluded.stripe_subscription_id,
        period_start = excluded.period_start, period_end = excluded.period_end,
        cancel_at_period_end = excluded.cancel_at_period_end, stripe_event_at = excluded.stripe_event_at, updated_at = now()
    where s.stripe_event_at is null or excluded.stripe_event_at >= s.stripe_event_at;
end $$;

revoke execute on function
  public.space_billed_user(uuid), public.current_plan_for(uuid),
  public.check_and_reserve_usage(uuid, numeric, boolean), public.settle_usage(uuid, timestamptz, timestamptz, numeric),
  public.get_billing_account(uuid), public.link_stripe_customer(uuid, text), public.sync_subscription(jsonb)
  from public, anon, authenticated;
grant execute on function
  public.space_billed_user(uuid), public.current_plan_for(uuid),
  public.check_and_reserve_usage(uuid, numeric, boolean), public.settle_usage(uuid, timestamptz, timestamptz, numeric),
  public.get_billing_account(uuid), public.link_stripe_customer(uuid, text), public.sync_subscription(jsonb)
  to service_role, space_runtime;

notify pgrst, 'reload schema';
