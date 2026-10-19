-- Commit file cleanup work alongside database deletion. Failed storage requests
-- remain queued and are retried; database deletion never loses the file path.
create table public.asset_file_cleanup (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  path text not null,
  created_at timestamptz not null default now(),
  unique(bucket,path)
);
alter table public.asset_file_cleanup enable row level security;
revoke all on public.asset_file_cleanup from public,anon,authenticated;

create function public.purge_deleted_asset(p_asset_id uuid, p_expired_only boolean default false) returns boolean
language plpgsql security definer set search_path=public as $$
declare a record; stored_svg text;
begin
  select id,deleted_at,origin,storage_path into a from public.assets where id=p_asset_id for update;
  if not found then return false; end if;
  if a.deleted_at is null then
    if p_expired_only then return false; end if;
    raise exception 'Move this asset to Deleted first.';
  end if;
  if p_expired_only and a.deleted_at > now()-interval '7 days' then return false; end if;
  if exists(select 1 from jsonb_array_elements(public.asset_app_usage()) u where u->>'assetId'=p_asset_id::text) then
    if p_expired_only then return false; end if;
    raise exception 'This asset is still in use. Remove its uses before permanently deleting it.';
  end if;
  select svg into stored_svg from public.generated_asset_content where asset_id=p_asset_id;
  -- Historical illustration versions must not retain dead file references or
  -- recreate a purged generated SVG when an older version is selected.
  update public.composer_runs r set composition=jsonb_set((r.composition::text)::jsonb,'{figures}',
    coalesce((select jsonb_agg(f order by n) from jsonb_array_elements((r.composition::text)::jsonb->'figures') with ordinality t(f,n)
      where (f->>'assetId') is distinct from p_asset_id::text
        and (stored_svg is null or (f->>'svg') is distinct from stored_svg)), '[]'::jsonb))
  where exists(select 1 from jsonb_array_elements((r.composition::text)::jsonb->'figures') f
    where f->>'assetId'=p_asset_id::text or (stored_svg is not null and f->>'svg'=stored_svg));
  delete from public.composer_cache where value::text like '%'||p_asset_id::text||'%';
  if a.origin in ('external','generated') and a.storage_path like 'composer-images/%'
    and not exists(select 1 from public.assets other where other.id<>p_asset_id and other.storage_path=a.storage_path) then
    insert into public.asset_file_cleanup(bucket,path) values('composer-images',substr(a.storage_path,length('composer-images/')+1))
      on conflict(bucket,path) do nothing;
  end if;
  delete from public.assets where id=p_asset_id;
  return true;
end $$;

create function public.expire_deleted_assets() returns integer
language plpgsql security definer set search_path=public as $$
declare a record; total integer := 0;
begin
  for a in select id from public.assets where deleted_at<=now()-interval '7 days'
    and id::text not in (select u->>'assetId' from jsonb_array_elements(public.asset_app_usage()) u)
    order by deleted_at limit 100
  loop
    if public.purge_deleted_asset(a.id,true) then total:=total+1; end if;
  end loop;
  return total;
end $$;

create function public.pending_asset_file_cleanup() returns jsonb
language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) from
    (select id,bucket,path from public.asset_file_cleanup order by created_at limit 100) q;
$$;
create function public.finish_asset_file_cleanup(p_id uuid) returns void
language sql security definer set search_path=public as $$
  delete from public.asset_file_cleanup where id=p_id;
$$;
revoke all on function public.purge_deleted_asset(uuid,boolean),public.expire_deleted_assets(),public.pending_asset_file_cleanup(),public.finish_asset_file_cleanup(uuid) from public,anon,authenticated;
grant execute on function public.purge_deleted_asset(uuid,boolean),public.expire_deleted_assets(),public.pending_asset_file_cleanup(),public.finish_asset_file_cleanup(uuid) to service_role;
notify pgrst,'reload schema';
