create table public.composer_cache (
  key text primary key,
  value jsonb not null,
  expires_at timestamptz not null
);
alter table public.composer_cache enable row level security;
revoke all on public.composer_cache from anon, authenticated;
create index composer_cache_expiry on public.composer_cache(expires_at);
create function public.read_composer_cache(p_key text) returns jsonb
language sql stable security definer set search_path=public as $$
  select (value::text)::jsonb from public.composer_cache where key=p_key and expires_at>now();
$$;
create function public.write_composer_cache(p_key text,p_value jsonb,p_ttl_seconds integer) returns void
language plpgsql security definer set search_path=public as $$
begin
  delete from public.composer_cache where expires_at<now();
  insert into public.composer_cache(key,value,expires_at)
  values(p_key,p_value,now()+make_interval(secs=>least(greatest(p_ttl_seconds,1),2592000)))
  on conflict(key) do update set value=excluded.value,expires_at=excluded.expires_at;
end $$;
revoke all on function public.read_composer_cache(text) from public,anon,authenticated;
revoke all on function public.write_composer_cache(text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.read_composer_cache(text) to service_role;
grant execute on function public.write_composer_cache(text,jsonb,integer) to service_role;
notify pgrst,'reload schema';
