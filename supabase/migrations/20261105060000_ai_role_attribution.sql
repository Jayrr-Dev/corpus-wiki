-- Preserve the participating roles and their actual models with each decision.
alter table public.change_sets add column actor_attribution jsonb;
alter table public.ai_calls add column role text;

create or replace function change_control.record_source_audit(p_type text, p_target uuid, p_input jsonb,
  p_before jsonb, p_summary text, p_actor public.actor_kind, p_model text default null,
  p_created timestamptz default now()) returns uuid
language plpgsql set search_path='' as $$
declare ev uuid; cs uuid; usage_in bigint; usage_out bigint; attribution jsonb;
begin
  select tokens_in,tokens_out,proposal->'_attribution' into usage_in,usage_out,attribution from public.external_source_reviews
    where id=case when p_type='source_review' then p_target else nullif(p_input->>'reviewId','')::uuid end;
  insert into public.shift_events(cause,actor,status,finished_at)
    values('edit',p_actor,'applied',now()) returning id into ev;
  insert into public.change_sets(event_id,proposed_by,status,summary,model_version,applied_at,created_at,tokens_in,tokens_out,actor_attribution)
    values(ev,p_actor,'applied',p_summary,p_model,now(),p_created,usage_in,usage_out,attribution) returning id into cs;
  insert into public.actions(change_set_id,position,type,target_id,input,undo_state,outcome,applied_at)
    values(cs,0,p_type::public.action_type,p_target,p_input,p_before,'applied',now());
  return cs;
end $$;


create or replace function public.log_ai_call(p_call jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into public.ai_calls (purpose, subject, model, reasoning_effort, prompt_tokens, completion_tokens,
                               reasoning_tokens, duration_ms, status, error, role)
  values (p_call ->> 'purpose', p_call ->> 'subject', p_call ->> 'model', p_call ->> 'reasoningEffort',
          (p_call ->> 'promptTokens')::integer, (p_call ->> 'completionTokens')::integer,
          (p_call ->> 'reasoningTokens')::integer, (p_call ->> 'durationMs')::integer,
          p_call ->> 'status', p_call ->> 'error', p_call ->> 'role');
$$;

