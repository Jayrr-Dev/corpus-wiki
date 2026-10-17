-- Keep cancelled sections as they read until an explicit Update resumes them.
alter table public.sections add column build_cancelled boolean not null default false;

alter function public.claim_section_build(uuid, uuid) rename to claim_section_build_unchecked;
create function public.claim_section_build(p_section_id uuid, p_event_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_cancelled boolean; v_result jsonb; v_token timestamptz;
begin
  select build_cancelled into v_cancelled from public.sections where id=p_section_id for update;
  if not found then raise exception 'Section not found.'; end if;
  if v_cancelled then return jsonb_build_object('claimed',false); end if;
  v_result := public.claim_section_build_unchecked(p_section_id,p_event_id);
  select building_since into v_token from public.sections where id=p_section_id;
  return v_result || jsonb_build_object('buildToken',v_token);
end $$;

create function public.cancel_section_build(p_section_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update public.sections set build_cancelled=true, status='current', building_since=null,
    rebuild_requested=false, rebuild_event_id=null
  where id=p_section_id and retired_at is null and status <> 'current';
  return jsonb_build_object('cancelled',found);
end $$;

create function public.resume_section_build(p_section_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update public.sections set build_cancelled=false where id=p_section_id and retired_at is null;
  return '{}'::jsonb;
end $$;

-- The row lock makes cancellation and saving mutually exclusive. A late response
-- from a cancelled (or replaced) build cannot write or release a newer claim.
create function public.section_build_write(p_section_id uuid,p_token timestamptz,p_function text,p_args jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_section public.sections%rowtype;
begin
  select * into v_section from public.sections where id=p_section_id for update;
  if not found or v_section.build_cancelled or v_section.status <> 'building'
    or v_section.building_since is distinct from p_token then
    return jsonb_build_object('buildCancelled',true);
  end if;
  case p_function
    when 'assert' then return '{}'::jsonb;
    when 'commit_change_set' then return public.commit_change_set((p_args->>'p_change_set_id')::uuid);
    when 'auto_accept_exceptions' then return public.auto_accept_exceptions(p_args->>'p_role',(p_args->>'p_change_set_id')::uuid);
    when 'upload_workflow_write' then return public.upload_workflow_write((p_args->>'p_event_id')::uuid,(p_args->>'p_token')::uuid,p_args->>'p_key',p_args->>'p_function',p_args->'p_args');
    when 'finish_section_build' then return public.finish_section_build(p_section_id,(p_args->>'p_event_id')::uuid,p_args->>'p_model_version',(p_args->>'p_changed')::boolean);
    when 'mark_section_stale' then return public.mark_section_stale(p_section_id);
    else raise exception 'Unsupported section build operation.';
  end case;
end $$;

revoke all on function public.claim_section_build_unchecked(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.claim_section_build(uuid,uuid), public.cancel_section_build(uuid), public.resume_section_build(uuid), public.section_build_write(uuid,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_section_build(uuid,uuid), public.cancel_section_build(uuid), public.resume_section_build(uuid), public.section_build_write(uuid,timestamptz,text,jsonb) to service_role;
