-- Stop a superseded assessment before it makes another paid image request.
create or replace function renew_composer_job(p_page_id uuid,p_token uuid) returns boolean
language plpgsql security definer set search_path=public as $$
begin
  update composer_jobs set lease_until=now()+interval '20 minutes'
  where page_id=p_page_id and token=p_token and lease_until>now()
    and claimed_snapshot=composer_page_snapshot(p_page_id);
  return found;
end $$;
revoke all on function renew_composer_job(uuid,uuid) from public,anon,authenticated;
grant execute on function renew_composer_job(uuid,uuid) to service_role;
notify pgrst,'reload schema';
