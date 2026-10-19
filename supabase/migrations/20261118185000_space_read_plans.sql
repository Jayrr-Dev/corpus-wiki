-- Resolve authorization once per SELECT rather than once per result row.
-- Realtime supplies a JWT without HTTP request headers, so it can read records
-- from all spaces owned by its subscriber; HTTP reads select exactly one space.
create function public.readable_space_ids() returns uuid[]
language sql stable security definer set search_path='' as $$
  select case when nullif(current_setting('request.headers',true),'') is null
    then array(select id from public.spaces where owner_id=auth.uid())
    else array[public.current_space_id()] end
$$;
revoke all on function public.readable_space_ids() from public,anon;
grant execute on function public.readable_space_ids() to authenticated,space_runtime,service_role;
do $$ declare t record; begin
  for t in select c.relname from pg_policy p join pg_class c on c.oid=p.polrelid
    where c.relnamespace='public'::regnamespace and p.polname='space_browser_boundary' loop
    execute format('alter policy space_browser_boundary on public.%I using (space_id = any (array(select unnest(public.readable_space_ids()))))',t.relname);
  end loop;
end $$;
drop function public.space_read_allowed(uuid);
notify pgrst,'reload schema';
