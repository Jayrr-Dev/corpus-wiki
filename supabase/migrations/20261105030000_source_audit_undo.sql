-- Source state changes and independent decisions use the same history and Undo
-- as knowledge edits. Triggers make the audit atomic, including legacy callers.
alter table public.external_source_reviews add column reverted_at timestamptz;

create function change_control.record_source_audit(p_type text, p_target uuid, p_input jsonb,
  p_before jsonb, p_summary text, p_actor public.actor_kind, p_model text default null,
  p_created timestamptz default now()) returns uuid
language plpgsql set search_path='' as $$
declare ev uuid; cs uuid;
begin
  insert into public.shift_events(cause,actor,status,finished_at)
    values('edit',p_actor,'applied',now()) returning id into ev;
  insert into public.change_sets(event_id,proposed_by,status,summary,model_version,applied_at,created_at)
    values(ev,p_actor,'applied',p_summary,p_model,now(),p_created) returning id into cs;
  insert into public.actions(change_set_id,position,type,target_id,input,undo_state,outcome,applied_at)
    values(cs,0,p_type::public.action_type,p_target,p_input,p_before,'applied',now());
  return cs;
end $$;

create function change_control.audit_source_lifecycle() returns trigger
language plpgsql security definer set search_path='' as $$
declare review public.external_source_reviews; verb text;
begin
  if new.archived_at is not distinct from old.archived_at and new.replaced_by_id is not distinct from old.replaced_by_id then return new; end if;
  select * into review from public.external_source_reviews where id=nullif(current_setting('app.source_review_id',true),'')::uuid;
  verb := case when new.archived_at is null then 'Restored' else 'Archived' end;
  perform change_control.record_source_audit('source_lifecycle',new.id,
    jsonb_build_object('title',new.title,'operation',verb,'archivedAt',new.archived_at,'replacedById',new.replaced_by_id,
      'reviewId',review.id,'reason',coalesce(review.reason,'User source action'),'context',review.context),
    jsonb_build_object('archivedAt',old.archived_at,'replacedById',old.replaced_by_id),
    verb||' source: '||new.title||case when review.id is null then '' else ' — '||review.reason end,
    case when review.id is null then 'person'::public.actor_kind else 'ai'::public.actor_kind end,review.model);
  return new;
end $$;
create trigger sources_audit_lifecycle after update of archived_at,replaced_by_id on public.sources
  for each row execute function change_control.audit_source_lifecycle();

create function change_control.audit_external_review() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform change_control.record_source_audit('source_review',new.id,
    jsonb_build_object('title',coalesce(new.source_title,new.context->>'section'),'stage',new.stage,
      'outcome',new.outcome,'reason',new.reason,'context',new.context,'proposal',new.proposal,
      'url',new.url,'excerpts',new.excerpts,'revertedAt',new.reverted_at),
    jsonb_build_object('revertedAt',null),
    'Approver '||new.outcome||' '||new.stage||': '||coalesce(new.source_title,new.context->>'section','External research')||' — '||new.reason,
    'ai',new.model,new.created_at);
  return new;
end $$;
create trigger external_reviews_audit after insert on public.external_source_reviews
  for each row execute function change_control.audit_external_review();

-- The review attribution and the archive are committed in one transaction.
create function public.set_source_archive(p_source_id uuid,p_archive boolean,p_review_id uuid default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_review_id is not null and not exists(select 1 from public.external_source_reviews
    where id=p_review_id and source_id=p_source_id and reverted_at is null and outcome in ('approved','rejected')) then
    raise exception 'A current review of this source is required.';
  end if;
  perform set_config('app.source_review_id',coalesce(p_review_id::text,''),true);
  update public.sources set archived_at=case when p_archive then now() else null end,
    replaced_by_id=case when p_archive then replaced_by_id else null end where id=p_source_id;
  if not found then raise exception 'That source no longer exists.'; end if;
end $$;
revoke all on function public.set_source_archive(uuid,boolean,uuid) from public,anon,authenticated;
grant execute on function public.set_source_archive(uuid,boolean,uuid) to service_role;

alter function change_control.undo_action(public.actions,uuid) rename to undo_action_before_source_audit;
create function change_control.undo_action(p_action public.actions,p_revert_event_id uuid)
returns void language plpgsql set search_path='' as $$
declare s public.sources; r public.external_source_reviews; old_reverted timestamptz; new_reverted timestamptz;
begin
  if p_action.type::text='source_lifecycle' then
    select * into s from public.sources where id=p_action.target_id for update;
    if not found then raise exception 'The source was deleted and cannot be restored.'; end if;
    if s.archived_at is distinct from (p_action.input->>'archivedAt')::timestamptz
      or s.replaced_by_id is distinct from (p_action.input->>'replacedById')::uuid then
      raise exception 'This source changed later. Undo that later source action first.';
    end if;
    perform set_config('app.source_review_id','',true);
    update public.sources set archived_at=(p_action.undo_state->>'archivedAt')::timestamptz,
      replaced_by_id=(p_action.undo_state->>'replacedById')::uuid where id=s.id;
  elsif p_action.type::text='source_review' then
    select * into r from public.external_source_reviews where id=p_action.target_id for update;
    if not found then raise exception 'The review no longer exists.'; end if;
    if r.reverted_at is distinct from (p_action.input->>'revertedAt')::timestamptz then
      raise exception 'This decision changed later. Undo its later reversal first.';
    end if;
    old_reverted:=r.reverted_at;
    new_reverted:=case when p_action.undo_state ? 'restoreReviewState' then (p_action.undo_state->>'revertedAt')::timestamptz else now() end;
    update public.external_source_reviews set reverted_at=new_reverted where id=r.id;
    -- Revoking admission also removes the approved source from active evidence.
    if new_reverted is not null and r.outcome='approved' and r.stage='source' and r.source_id is not null then
      perform set_config('app.source_review_id','',true);
      update public.sources set archived_at=now() where id=r.source_id and archived_at is null;
    end if;
    perform change_control.record_source_audit('source_review',r.id,
      p_action.input||jsonb_build_object('revertedAt',new_reverted,'reason','User reversed the previous review action'),
      jsonb_build_object('revertedAt',old_reverted,'restoreReviewState',true),
      case when new_reverted is null then 'Reinstated' else 'Reversed' end||' approver decision: '||coalesce(r.source_title,r.context->>'section','External research'), 'person');
  else
    perform change_control.undo_action_before_source_audit(p_action,p_revert_event_id);
    return;
  end if;
  update public.actions set outcome='reverted',reverted_by_event_id=p_revert_event_id where id=p_action.id;
end $$;

create or replace function public.require_external_source_approval()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.origin='external' and not exists(select 1 from public.external_source_reviews r
    where r.source_id=new.id and r.stage='source' and r.outcome='approved' and r.reverted_at is null
      and r.url=new.url and r.source_title=new.title) then
    raise exception 'External sources require independent approval before admission.';
  end if;
  return new;
end $$;

-- Include decisions and archives from the review that preceded this migration.
do $$ declare r public.external_source_reviews; s public.sources;
begin
  for r in select * from public.external_source_reviews order by created_at loop
    perform change_control.record_source_audit('source_review',r.id,
      jsonb_build_object('title',r.source_title,'stage',r.stage,'outcome',r.outcome,'reason',r.reason,
        'context',r.context,'proposal',r.proposal,'url',r.url,'excerpts',r.excerpts,'revertedAt',null),
      jsonb_build_object('revertedAt',null),'Approver '||r.outcome||' '||r.stage||': '||coalesce(r.source_title,'External research')||' — '||r.reason,'ai',r.model,r.created_at);
  end loop;
  for s in select * from public.sources where archived_at is not null loop
    select * into r from public.external_source_reviews where source_id=s.id and outcome='rejected' order by created_at desc limit 1;
    if found then
      perform change_control.record_source_audit('source_lifecycle',s.id,
        jsonb_build_object('title',s.title,'operation','Archived','archivedAt',s.archived_at,'replacedById',s.replaced_by_id,'reviewId',r.id,'reason',r.reason,'context',r.context),
        jsonb_build_object('archivedAt',null,'replacedById',null),
        'Archived source: '||s.title||' — '||r.reason,'ai',r.model,s.archived_at);
    end if;
  end loop;
end $$;
revoke all on function change_control.record_source_audit(text,uuid,jsonb,jsonb,text,public.actor_kind,text,timestamptz) from public,anon,authenticated;
notify pgrst,'reload schema';
