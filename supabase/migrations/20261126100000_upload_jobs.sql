-- Small idempotent upload jobs (issue 47). Table only: functions and wiring come later
-- (docs/upload-jobs-plan.md). B-tree indexes only (OrioleDB).
create table public.upload_jobs (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references public.upload_workflows(event_id) on delete cascade,
 kind text not null,
 key text not null,
 input jsonb not null default '{}'::jsonb,
 depends_on text[] not null default '{}',
 state text not null default 'blocked' check (state in ('blocked','ready','running','succeeded','failed','cancelled')),
 provider text,
 token uuid, lease_until timestamptz,
 attempts integer not null default 0, max_attempts integer not null default 3,
 available_at timestamptz not null default now(),
 output jsonb, last_error text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (event_id, key)
);
create index upload_jobs_ready_idx on public.upload_jobs(available_at) where state='ready';
create index upload_jobs_event_state_idx on public.upload_jobs(event_id, state);
alter table public.upload_jobs enable row level security;
grant all on public.upload_jobs to service_role;
