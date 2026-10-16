-- A new AI root is held BEFORE any knowledge in its upload is applied.
-- Every proposed root gets its own question. Once all are answered, the
-- original checks run; rejected roots and changes depending on them are dropped.
alter type public.exception_reason add value if not exists 'root_domain_approval';

alter function public.commit_change_set(uuid) rename to commit_before_root_approval;
alter function public.resolve_exception(uuid,boolean,text) rename to resolve_before_root_approval;
alter function change_control.judge(public.actions,public.actor_kind) rename to judge_before_root_approval;

create function change_control.judge(p_action public.actions,p_proposed_by public.actor_kind)
returns jsonb language plpgsql stable set search_path='' as $$
begin
  if exists(select 1 from public.exceptions where action_id=p_action.id
    and reason::text='root_domain_approval' and status='rejected') then
    return jsonb_build_object('outcome','rejected','checks',jsonb_build_array(
      change_control.check('root_approval',false,'The proposed root domain was rejected.')));
  end if;
  -- Children cannot become accidental roots when their proposed parent was rejected.
  if p_action.type='create_domain' and nullif(p_action.input->>'parentPath','') is not null
    and not exists(select 1 from public.domains where path=p_action.input->>'parentPath' and retired_at is null) then
    return jsonb_build_object('outcome','rejected','checks',jsonb_build_array(
      change_control.check('domain_parent',false,'The parent domain is not available.')));
  end if;
  return change_control.judge_before_root_approval(p_action,p_proposed_by);
end $$;

create function public.commit_change_set(p_change_set_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.change_sets; a public.actions; paths jsonb;
begin
  select * into s from public.change_sets where id=p_change_set_id for update;
  if s.id is null then raise exception 'ChangeSet does not exist'; end if;
  if s.status<>'draft' then raise exception 'ChangeSet is already %',s.status; end if;
  if s.proposed_by='ai' then
    for a in select * from public.actions where change_set_id=s.id and type='create_domain'
      and nullif(input->>'parentPath','') is null
      and not exists(select 1 from public.domains d where d.path=actions.input->>'path' and d.retired_at is null)
      and not exists(select 1 from public.exceptions x where x.action_id=actions.id and x.reason::text='root_domain_approval')
      order by position
    loop
      select jsonb_agg(input->>'path' order by position) into paths from public.actions
        where change_set_id=s.id and type='create_domain'
        and (input->>'path'=a.input->>'path' or starts_with(input->>'path',(a.input->>'path')||'/'));
      insert into public.exceptions(action_id,reason,evidence)
        values(a.id,'root_domain_approval',jsonb_build_object('domainPaths',paths,'detail',
          'Create the new root domain “'||(a.input->>'path')||'”? Roots should normally represent companies or organizations, with departments and topics underneath. This upload waits until all root proposals are answered.'));
    end loop;
    if exists(select 1 from public.exceptions ex join public.actions act on act.id=ex.action_id
      where act.change_set_id=s.id and ex.reason::text='root_domain_approval' and ex.status='open') then
      update public.actions set outcome='exception' where change_set_id=s.id;
      perform change_control.refresh_status(s.id);
      return change_control.commit_summary(s.id,'partly_applied');
    end if;
  end if;
  return public.commit_before_root_approval(s.id);
end $$;

create function public.resolve_exception(p_exception_id uuid,p_accept boolean,p_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare x public.exceptions; a public.actions; s public.change_sets;
begin
  -- Lock the set first so answering two roots cannot race or deadlock.
  select cs.* into s from public.change_sets cs join public.actions act on act.change_set_id=cs.id
    join public.exceptions ex on ex.action_id=act.id where ex.id=p_exception_id for update of cs;
  select * into x from public.exceptions where id=p_exception_id for update;
  if x.reason::text is distinct from 'root_domain_approval' then
    return public.resolve_before_root_approval(p_exception_id,p_accept,p_note);
  end if;
  if x.status is distinct from 'open' then raise exception 'This exception is already answered.'; end if;
  select * into a from public.actions where id=x.action_id;
  update public.exceptions set status=case when p_accept then 'accepted' else 'rejected' end::public.exception_status,
    resolved_at=now(),note=p_note where id=x.id;
  if exists(select 1 from public.exceptions ex join public.actions act on act.id=ex.action_id
    where act.change_set_id=s.id and ex.reason::text='root_domain_approval' and ex.status='open') then
    return jsonb_build_object('eventId',null);
  end if;
  update public.actions set outcome='pending' where change_set_id=s.id and outcome='exception';
  update public.change_sets set status='draft' where id=s.id;
  perform public.commit_change_set(s.id);
  return jsonb_build_object('eventId',s.event_id);
end $$;

-- The old one-time, after-the-fact review is superseded by approval before creation.
create or replace function change_control.raise_domain_review(p_change_set_id uuid)
returns void language plpgsql set search_path='' as $$ begin return; end $$;

-- Enforce the rule even for legacy organizers that insert domains directly.
create function change_control.require_root_approval()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.parent_id is null and new.proposed_by='ai' and not exists(
    select 1 from public.actions a join public.exceptions x on x.action_id=a.id
    where a.type='create_domain' and a.input->>'path'=new.path and a.target_id is null
      and a.outcome in ('pending','exception') and x.reason::text='root_domain_approval' and x.status='accepted'
  ) then raise exception 'AI root domains require approval before creation.'; end if;
  return new;
end $$;
create trigger domains_require_root_approval before insert on public.domains
  for each row execute function change_control.require_root_approval();

revoke all on function public.commit_change_set(uuid) from public,anon,authenticated;
revoke all on function public.resolve_exception(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.commit_change_set(uuid) to service_role;
grant execute on function public.resolve_exception(uuid,boolean,text) to service_role;
