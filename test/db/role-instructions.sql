begin;
do $$
declare prior_version integer; saved_version integer;
begin
  select version into prior_version from public.ai_role_instructions where role = 'researcher';
  perform public.save_ai_role_instructions('researcher', 'Role instruction persistence test', prior_version);
  select version into saved_version from public.ai_role_instructions where role = 'researcher';
  if not exists (select 1 from jsonb_array_elements(public.get_ai_role_instructions()) r where r->>'role' = 'researcher' and r->>'instructions' = 'Role instruction persistence test') then
    raise exception 'Saved instructions were not returned';
  end if;
  begin
    perform public.save_ai_role_instructions('researcher', 'Stale update', prior_version);
    raise exception 'Stale version was accepted';
  exception when raise_exception then
    if sqlerrm <> 'These instructions changed. Reload and try again.' then raise; end if;
  end;
  perform public.save_ai_role_instructions('researcher', null, saved_version);
  if exists (select 1 from public.ai_role_instructions where role = 'researcher') then
    raise exception 'Reset did not clear the override';
  end if;
end;
$$;
rollback;
