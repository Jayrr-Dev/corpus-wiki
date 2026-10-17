create function public.domain_decider_connections() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('from',r.from_unit_id,'to',r.to_unit_id,'type',r.type) order by r.id),'[]')
 from public.relationships r join public.units a on a.id=r.from_unit_id join public.units b on b.id=r.to_unit_id
 where r.retired_at is null and a.retired_at is null and b.retired_at is null;
$$;
revoke all on function public.domain_decider_connections() from public,anon,authenticated;
grant execute on function public.domain_decider_connections() to service_role;
