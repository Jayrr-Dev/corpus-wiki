create function composer_assets_for_svgs(p_svgs text[]) returns jsonb
language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(asset_id),'[]') from generated_asset_content where svg=any(p_svgs);
$$;
revoke all on function composer_assets_for_svgs(text[]) from public,anon,authenticated;
grant execute on function composer_assets_for_svgs(text[]) to service_role;
notify pgrst,'reload schema';
