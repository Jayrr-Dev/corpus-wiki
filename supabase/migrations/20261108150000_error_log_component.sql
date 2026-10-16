-- =====================================================================
-- SECOND BRAIN · ERROR LOG: WHICH COMPONENT
-- =====================================================================
-- Each error also names the component it happened in (read from the
-- React component stack, or the first component-like frame of the stack
-- trace), shown on /errors beside the page path.
-- =====================================================================

alter table public.error_log add column component text;

-- WRITE ONE ERROR: p_error = { level, source, location, path, component, message, stack, digest, personId }
create or replace function public.log_error(p_error jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into public.error_log (level, source, location, path, component, message, stack, digest, person_id)
  values (coalesce(p_error ->> 'level', 'error'), p_error ->> 'source', left(p_error ->> 'location', 500),
          left(p_error ->> 'path', 1000), left(p_error ->> 'component', 500),
          left(coalesce(p_error ->> 'message', 'Unknown error'), 4000),
          left(p_error ->> 'stack', 12000), p_error ->> 'digest', (p_error ->> 'personId')::uuid);
$$;

revoke execute on function public.log_error(jsonb) from public, anon, authenticated;
grant execute on function public.log_error(jsonb) to service_role;
