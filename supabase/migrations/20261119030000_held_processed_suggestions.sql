-- A later suggestion run leaves claims alone once a suggestion has them.
-- Pending and accepting were already held. Failed and applied are processed too.
-- Dismissed and stale stay free: a dismissed group can return when its claims change,
-- and a stale suggestion asks for another run.

create or replace function public.held_suggestion_units() returns setof uuid
language sql stable security definer set search_path='' as $$
 select distinct unnest(unit_ids) from public.article_suggestions
 where space_id=public.current_space_id() and status in ('pending','accepting','failed','applied')
$$;

alter function public.held_suggestion_units() owner to space_runtime;
revoke all on function public.held_suggestion_units() from public,anon,authenticated;
grant execute on function public.held_suggestion_units() to service_role,space_runtime;
notify pgrst,'reload schema';
