-- Shared graph history. Replays run through the original validators atomically.
create function public.graph_edit_history() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'undo', (select jsonb_build_object('id',c.id,'summary',c.summary)
      from public.change_sets c where c.status = 'applied'
      and exists(select 1 from public.actions a where a.change_set_id=c.id and a.outcome='applied')
      and not exists(select 1 from public.actions a where a.change_set_id=c.id
        and (a.outcome <> 'applied' or a.type::text not in ('create_domain','update_domain','retire_domain','place_claim','link')))
      order by c.created_at desc,c.id desc limit 1),
    'fingerprint', md5(jsonb_build_object('domains',public.domain_review_snapshot(),
      'links',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') from public.relationships r),
      'changes',(select coalesce(jsonb_agg(jsonb_build_array(c.id,c.status) order by c.id),'[]') from public.change_sets c))::text)
  );
$$;

create function public.step_graph_history(p_id uuid,p_direction text,p_fingerprint text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare h jsonb; c public.change_sets; result jsonb;
begin
  -- Fence the check and write together, including concurrent background writers.
  lock table public.change_sets,public.actions,public.domains,public.unit_domains,
    public.units,public.revisions,public.relationships,public.pages,public.sections,public.domain_tabs in share row exclusive mode;
  h:=public.graph_edit_history();
  if h->>'fingerprint' is distinct from p_fingerprint then
    raise exception 'Graph changed. Please try again.';
  end if;
  select * into c from public.change_sets where id=p_id;
  if c.id is null then raise exception 'Edit not found.'; end if;
  if p_direction='undo' then
    if h->'undo'->>'id' is distinct from p_id::text then raise exception 'Undo the latest edit first.'; end if;
    perform public.revert_change_set(p_id);
  elsif p_direction='redo' then
    if c.status<>'reverted' or not exists(select 1 from public.actions where change_set_id=p_id)
      or exists(select 1 from public.actions where change_set_id=p_id and
        (outcome<>'reverted' or type::text not in ('create_domain','update_domain','retire_domain','place_claim','link')))
      then raise exception 'This edit cannot be redone.'; end if;
    -- Keep the same history position. The original undo event remains in the audit trail.
    perform set_config('app.graph_redo_domains',coalesce((select jsonb_agg(d) from public.actions a
      cross join lateral jsonb_array_elements(case when a.type='create_domain' then jsonb_build_array(jsonb_build_object('id',a.target_id,'path',a.input->>'path'))
        else coalesce(a.undo_state->'after'->'domains','[]') end) d where a.change_set_id=p_id),'[]')::text,true);
    update public.actions set outcome='pending',
      input=case when input->>'domainDecider'='true' then input || jsonb_build_object(
        'snapshot',public.domain_review_snapshot(),'connectionSnapshot',public.domain_decider_connections()) else input end
      where change_set_id=p_id;
    update public.change_sets set status='draft' where id=p_id;
    result:=public.commit_change_set(p_id);
    perform set_config('app.graph_redo_domains','',true);
    if result->>'status'<>'applied' then raise exception 'This edit no longer fits the graph. Nothing was changed.'; end if;
  else raise exception 'Invalid history direction.';
  end if;
  return jsonb_build_object('fingerprint',public.graph_edit_history()->>'fingerprint');
end $$;
revoke all on function public.graph_edit_history(),public.step_graph_history(uuid,text,text) from public,anon,authenticated;
grant execute on function public.graph_edit_history(),public.step_graph_history(uuid,text,text) to service_role;

-- Removing/restoring links uses the same audited action history as adding links.
alter function change_control.check_link(public.actions) rename to check_link_before_graph_history;
create function change_control.check_link(p_action public.actions) returns jsonb
language plpgsql stable set search_path='' as $$
begin
 if p_action.type='link' and p_action.input ? 'graphLinkId' then
  return change_control.check('link',exists(select 1 from public.relationships r
    where r.id=(p_action.input->>'graphLinkId')::uuid and r.from_unit_id=p_action.target_id
      and r.to_unit_id=(p_action.input->>'toUnitId')::uuid and r.type::text=p_action.input->>'type'
      and r.retired_at is not distinct from (p_action.input->>'expectedRetiredAt')::timestamptz),
    'The link changed. Refresh and try again.');
 end if;
 return change_control.check_link_before_graph_history(p_action);
end $$;
alter function change_control.apply_link(public.actions,uuid) rename to apply_link_before_graph_history;
create function change_control.apply_link(p_action public.actions,p_event_id uuid) returns void
language plpgsql set search_path='' as $$
declare r public.relationships; next_retired timestamptz;
begin
 if not (p_action.input ? 'graphLinkId') then
  if p_action.reverted_by_event_id is not null and p_action.undo_state ? 'relationshipId' then
   update public.relationships set retired_at=null where id=(p_action.undo_state->>'relationshipId')::uuid
     and from_unit_id=p_action.target_id and to_unit_id=(p_action.input->>'toUnitId')::uuid
     and type::text=p_action.input->>'type' and retired_at is not null;
   if found then return; end if;
  end if;
  perform change_control.apply_link_before_graph_history(p_action,p_event_id); return;
 end if;
 select * into r from public.relationships where id=(p_action.input->>'graphLinkId')::uuid for update;
 if r.id is null or r.retired_at is distinct from (p_action.input->>'expectedRetiredAt')::timestamptz then
  raise exception 'The link changed. Refresh and try again.';
 end if;
 if not (p_action.input->>'removed')::boolean then
  if exists(select 1 from public.units where id in (r.from_unit_id,r.to_unit_id) and retired_at is not null)
    or exists(select 1 from public.relationships x where x.id<>r.id and x.retired_at is null and x.type=r.type
      and ((x.from_unit_id=r.from_unit_id and x.to_unit_id=r.to_unit_id)
        or (r.type in ('related_to','contradicts') and x.from_unit_id=r.to_unit_id and x.to_unit_id=r.from_unit_id))) then
    raise exception 'Cannot restore this link: an endpoint is retired or a matching link exists.';
  end if;
 end if;
 next_retired:=case when (p_action.input->>'removed')::boolean then now() else null end;
 update public.relationships set retired_at=next_retired where id=r.id;
 update public.actions set undo_state=jsonb_build_object('graphLinkId',r.id,'before',r.retired_at,'after',next_retired) where id=p_action.id;
end $$;
alter function change_control.undo_action(public.actions,uuid) rename to undo_action_before_graph_history;
create function change_control.undo_action(p_action public.actions,p_revert_event_id uuid) returns void
language plpgsql set search_path='' as $$
begin
 if p_action.type='link' and p_action.undo_state ? 'graphLinkId' then
  update public.relationships set retired_at=(p_action.undo_state->>'before')::timestamptz
    where id=(p_action.undo_state->>'graphLinkId')::uuid
      and retired_at is not distinct from (p_action.undo_state->>'after')::timestamptz;
  if not found then raise exception 'The link changed. Undo its newer edit first.'; end if;
  update public.actions set outcome='reverted',reverted_by_event_id=p_revert_event_id where id=p_action.id;
 else perform change_control.undo_action_before_graph_history(p_action,p_revert_event_id);
 end if;
end $$;
revoke all on function change_control.check_link(public.actions),change_control.apply_link(public.actions,uuid),
 change_control.undo_action(public.actions,uuid),change_control.check_link_before_graph_history(public.actions),
 change_control.apply_link_before_graph_history(public.actions,uuid),change_control.undo_action_before_graph_history(public.actions,uuid)
 from public,anon,authenticated;

-- A replay keeps created domain identities, so later rename/move edits can be redone too.
create function change_control.graph_redo_domain_identity() returns trigger language plpgsql set search_path='' as $$
declare originals jsonb:=nullif(current_setting('app.graph_redo_domains',true),'')::jsonb; prior_id uuid;
begin
 select (d->>'id')::uuid into prior_id from jsonb_array_elements(coalesce(originals,'[]')) d where d->>'path'=new.path limit 1;
 if prior_id is not null then new.id:=prior_id; end if;
 return new;
end $$;
create trigger graph_redo_domain_identity before insert on public.domains for each row execute function change_control.graph_redo_domain_identity();
revoke all on function change_control.graph_redo_domain_identity() from public,anon,authenticated;
