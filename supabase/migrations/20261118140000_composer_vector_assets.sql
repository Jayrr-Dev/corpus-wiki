create function public.store_generated_vector(p_asset_id uuid,p_svg text,p_caption text) returns void
language plpgsql security definer set search_path=public as $$
begin
  if length(p_svg)>4000000 or not exists(select 1 from assets where id=p_asset_id and origin='generated' and mime_type='image/svg+xml') then
    raise exception 'Invalid generated vector asset';
  end if;
  insert into generated_asset_content(asset_id,svg,original_caption) values(p_asset_id,p_svg,p_caption);
end $$;
revoke all on function public.store_generated_vector(uuid,text,text) from public,anon,authenticated;
grant execute on function public.store_generated_vector(uuid,text,text) to service_role;
notify pgrst,'reload schema';
