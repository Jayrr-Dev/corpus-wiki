-- Unlink is explicit and only available for trashed library images. Source
-- evidence belongs to the source lifecycle and must not be silently rewritten.
create function public.unlink_deleted_asset(p_asset_id uuid) returns integer
language plpgsql security definer set search_path=public as $$
declare a record; stored_svg text; affected integer; total integer := 0;
begin
  select id,deleted_at,origin,media_url into a from public.assets where id=p_asset_id for update;
  if not found then raise exception 'This asset no longer exists.'; end if;
  if a.deleted_at is null then raise exception 'Move this asset to Deleted first.'; end if;
  if a.origin='source' then
    raise exception 'This image belongs to a source. Remove the source through Sources to clean up its evidence safely.';
  end if;
  select svg into stored_svg from public.generated_asset_content where asset_id=p_asset_id;
  -- Include inactive versions so selecting an older run cannot restore a link.
  update public.composer_runs r set composition=jsonb_set((r.composition::text)::jsonb,'{figures}',
    coalesce((select jsonb_agg(f order by n) from jsonb_array_elements((r.composition::text)::jsonb->'figures') with ordinality t(f,n)
      where (f->>'assetId') is distinct from p_asset_id::text
        and (stored_svg is null or (f->>'svg') is distinct from stored_svg)), '[]'::jsonb))
  where exists(select 1 from jsonb_array_elements((r.composition::text)::jsonb->'figures') f
    where f->>'assetId'=p_asset_id::text or (stored_svg is not null and f->>'svg'=stored_svg));
  get diagnostics affected = row_count; total:=total+affected;
  -- Hidden stakeholder cards also need their links removed.
  update public.entity_profiles set logo_url=null
  where logo_url=a.media_url or logo_url in (
    '/api/assets/'||p_asset_id||'/image', '/api/assets/'||p_asset_id||'/vector', '/api/assets/'||p_asset_id||'/generated');
  get diagnostics affected = row_count; total:=total+affected;
  delete from public.composer_cache where value::text like '%'||p_asset_id::text||'%';
  return total;
end $$;
revoke all on function public.unlink_deleted_asset(uuid) from public,anon,authenticated;
grant execute on function public.unlink_deleted_asset(uuid) to service_role;
notify pgrst,'reload schema';
