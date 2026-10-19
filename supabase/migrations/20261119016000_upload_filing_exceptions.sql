-- A filing batch the independent review still disputes after its retry budget
-- no longer pauses the whole upload. Its best proposal is submitted with the rest,
-- and each disputed placement (input.filingReview) is held in Exceptions as
-- low confidence for a person. The other batches file and the upload goes on.
-- Accepting applies the held placement (and rebuilds that upload's pages);
-- the Domain Decider in full auto accepts it at once, like other roles.

alter function change_control.judge(public.actions, public.actor_kind) rename to judge_before_filing_review;
create function change_control.judge(p_action public.actions, p_proposed_by public.actor_kind)
returns jsonb language plpgsql stable set search_path = '' as $$
declare v_result jsonb := change_control.judge_before_filing_review(p_action, p_proposed_by);
begin
  if p_action.type::text = 'place_claim' and p_action.input ? 'filingReview' and p_proposed_by = 'ai'
     and v_result ->> 'outcome' = 'applied' then
    return jsonb_build_object('outcome', 'exception', 'reason', 'low_confidence',
      'detail', p_action.input -> 'filingReview' ->> 'detail', 'checks', v_result -> 'checks');
  end if;
  return v_result;
end $$;

-- Held placements are accounted for: the filing stage finishes, and a later run of the
-- stage does not file them a second time while a person decides.
create function change_control.upload_placement_held(p_event_id uuid, p_unit_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists(select 1 from public.exceptions x join public.actions a on a.id = x.action_id
    join public.change_sets c on c.id = a.change_set_id
    where c.event_id = p_event_id and a.target_id = p_unit_id and a.type::text = 'place_claim' and x.status = 'open')
$$;

create or replace function public.verify_upload_topic_coverage(p_event_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('unplaced',coalesce((
  select jsonb_agg(u.id order by u.id) from public.units u where u.retired_at is null
    and exists(select 1 from public.actions a join public.change_sets c on c.id=a.change_set_id
      where c.event_id=p_event_id and a.target_id=u.id and a.outcome='applied' and a.type::text in ('add_claim','revise_claim'))
    and not exists(select 1 from public.unit_domains m join public.domains d on d.id=m.domain_id where m.unit_id=u.id and d.retired_at is null)
    and not change_control.upload_placement_held(p_event_id,u.id)
 ),'[]'));
$$;

do $$ declare definition text; patched text; had_create boolean; begin
  definition := pg_get_functiondef('public.upload_unplaced_claims(uuid)'::regprocedure);
  patched := replace(definition,
    'not exists (select 1 from public.unit_domains ud join public.domains d on d.id=ud.domain_id where ud.unit_id=u.id and d.retired_at is null)',
    'not exists (select 1 from public.unit_domains ud join public.domains d on d.id=ud.domain_id where ud.unit_id=u.id and d.retired_at is null) and not change_control.upload_placement_held(p_event_id, u.id)');
  if patched = definition then raise exception 'Expected unplaced-claims filter changed; review held filing placements'; end if;
  execute patched;

  definition := pg_get_functiondef('public.set_ai_role_auto(text,boolean)'::regprocedure);
  patched := replace(definition, '''domain_steward'',''curator'')', '''domain_steward'',''curator'',''domain_decider'')');
  if patched = definition then raise exception 'Expected full-auto role list changed; review domain_decider'; end if;
  execute patched;

  had_create := has_schema_privilege('space_runtime','change_control','CREATE');
  if not had_create then grant create on schema change_control to space_runtime; end if;
  alter function change_control.judge(public.actions, public.actor_kind) owner to space_runtime;
  alter function change_control.upload_placement_held(uuid, uuid) owner to space_runtime;
  if not had_create then revoke create on schema change_control from space_runtime; end if;
end $$;
revoke all on function change_control.judge(public.actions, public.actor_kind), change_control.judge_before_filing_review(public.actions, public.actor_kind),
  change_control.upload_placement_held(uuid, uuid) from public, anon, authenticated;
grant execute on function change_control.judge(public.actions, public.actor_kind), change_control.upload_placement_held(uuid, uuid) to space_runtime;
notify pgrst, 'reload schema';
