-- The background sweep reads stale sections with the service role.
grant select on public.stale_lines to service_role;
