-- A person may recover an expired generation, but its old worker must then lose ownership.
create function change_control.fence_expired_glossary_edit() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.status='ready' and new.lease_until<=clock_timestamp() then
   new.lease_token:=null; new.lease_until:=null;
 end if;
 return new;
end $$;
create trigger glossary_edit_fencing before update on public.glossary_state
 for each row execute function change_control.fence_expired_glossary_edit();
revoke all on function change_control.fence_expired_glossary_edit() from public,anon,authenticated;
