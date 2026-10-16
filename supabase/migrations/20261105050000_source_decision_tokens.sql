-- Store provider usage with reviews and copy it into decision history atomically.
alter table public.external_source_reviews
  add column tokens_in bigint check (tokens_in >= 0),
  add column tokens_out bigint check (tokens_out >= 0);

create or replace function change_control.record_source_audit(p_type text, p_target uuid, p_input jsonb,
  p_before jsonb, p_summary text, p_actor public.actor_kind, p_model text default null,
  p_created timestamptz default now()) returns uuid
language plpgsql set search_path='' as $$
declare ev uuid; cs uuid; usage_in bigint; usage_out bigint;
begin
  select tokens_in,tokens_out into usage_in,usage_out from public.external_source_reviews
    where id=case when p_type='source_review' then p_target else nullif(p_input->>'reviewId','')::uuid end;
  insert into public.shift_events(cause,actor,status,finished_at)
    values('edit',p_actor,'applied',now()) returning id into ev;
  insert into public.change_sets(event_id,proposed_by,status,summary,model_version,applied_at,created_at,tokens_in,tokens_out)
    values(ev,p_actor,'applied',p_summary,p_model,now(),p_created,usage_in,usage_out) returning id into cs;
  insert into public.actions(change_set_id,position,type,target_id,input,undo_state,outcome,applied_at)
    values(cs,0,p_type::public.action_type,p_target,p_input,p_before,'applied',now());
  return cs;
end $$;

