-- =====================================================================
-- SECOND BRAIN · ERROR LOG
-- =====================================================================
-- One row per error anywhere in the app, so the person can see what went
-- wrong without reading the server terminal:
--   server  an uncaught error in a page render, route, server action or the proxy
--   action  a server action that failed and showed its message on screen
--   console server code that logged an error or warning (background jobs, fallbacks)
--   client  a crash or unhandled error in the browser
--   ai      an AI provider call that failed (copied from ai_calls)
-- Server code writes it through log_error (service_role only); the signed-in
-- user reads it on /errors and may clear it.
-- =====================================================================

create table public.error_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  level text not null default 'error' check (level in ('error', 'warning')),
  source text not null check (source in ('server', 'action', 'console', 'client', 'ai')),
  location text,                             -- where it happened: a route, a boundary, a purpose
  path text,                                 -- the page or request path, when known
  message text not null,
  stack text,
  digest text,                               -- Next.js error digest, to match a screen to the server log
  person_id uuid
);
comment on table public.error_log is 'One row per error anywhere in the app: server, server action, browser, background job or AI call.';
create index error_log_created_idx on public.error_log (created_at desc);

alter table public.error_log enable row level security;
revoke all on public.error_log from anon, authenticated;
grant select, delete on public.error_log to authenticated;
create policy error_log_read on public.error_log for select to authenticated using (true);
create policy error_log_clear on public.error_log for delete to authenticated using (true);

-- WRITE ONE ERROR: p_error = { level, source, location, path, message, stack, digest, personId }
create function public.log_error(p_error jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into public.error_log (level, source, location, path, message, stack, digest, person_id)
  values (coalesce(p_error ->> 'level', 'error'), p_error ->> 'source', left(p_error ->> 'location', 500),
          left(p_error ->> 'path', 1000), left(coalesce(p_error ->> 'message', 'Unknown error'), 4000),
          left(p_error ->> 'stack', 12000), p_error ->> 'digest', (p_error ->> 'personId')::uuid);
$$;

revoke execute on function public.log_error(jsonb) from public, anon, authenticated;
grant execute on function public.log_error(jsonb) to service_role;

-- FAILED AI CALLS land in the error log too
create function public.error_log_from_ai_call()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.error_log (source, location, message)
  values ('ai', new.purpose || coalesce(' · ' || new.subject, '') || ' (' || new.model || ')',
          left(coalesce(new.error, 'AI call failed'), 4000));
  return new;
end;
$$;

create trigger ai_calls_error_log after insert on public.ai_calls
  for each row when (new.status = 'error') execute function public.error_log_from_ai_call();
