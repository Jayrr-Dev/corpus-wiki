-- Exact citation revision IDs distinguish a no-op from a citation-only update.
create or replace function public.read_section_state(p_section_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  with state as materialized (select public.read_section_state_before_context(p_section_id) as base)
  select base || jsonb_build_object(
    'units', coalesce((select jsonb_agg(unit||jsonb_build_object('context',r.knowledge_context) order by ordinality)
      from jsonb_array_elements(base->'units') with ordinality as e(unit,ordinality)
      left join public.revisions r on r.id=(unit->>'revisionId')::uuid),'[]'::jsonb),
    'lines', coalesce((select jsonb_agg(line||jsonb_build_object('unitRevisionIds',r.unit_revision_ids) order by ordinality)
      from jsonb_array_elements(base->'lines') with ordinality as e(line,ordinality)
      join public.line_revisions r on r.id=(line->>'lineRevisionId')::uuid),'[]'::jsonb)
  ) from state
$$;

-- A section's patch batch either commits in full or leaves every line intact.
-- Keep the existing audited actions and inverse operations for undo.
create function public.commit_text_patch_set(p_change_set_id uuid, p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; v_action public.actions; line public.lines; section public.sections;
begin
  perform 1 from public.change_sets where id=p_change_set_id for update;
  if jsonb_typeof(p_evidence) is distinct from 'array' then raise exception 'Invalid patch evidence'; end if;
  if exists(select 1 from public.actions where change_set_id=p_change_set_id and type::text not in ('revise_line','retire_line','write_line')) then
    raise exception 'Text patches may only edit paragraphs';
  end if;
  perform 1 from public.units u where u.id in (select (e->>'unitId')::uuid from jsonb_array_elements(p_evidence) e) order by u.id for share;
  if exists(select 1 from jsonb_array_elements(p_evidence) e left join public.units u on u.id=(e->>'unitId')::uuid
    where u.id is null or u.retired_at is not null or u.current_revision_id is distinct from (e->>'revisionId')::uuid) then
    raise exception 'Evidence changed while these edits were drafted. Run the update again.';
  end if;
  perform 1 from public.sections s where s.id in (
    select l.section_id from public.lines l join public.actions a on a.target_id=l.id where a.change_set_id=p_change_set_id
    union select (a.input->>'sectionId')::uuid from public.actions a where a.change_set_id=p_change_set_id and a.type::text='write_line'
  ) order by s.id for share;
  perform 1 from public.lines l join public.actions a on a.target_id=l.id where a.change_set_id=p_change_set_id order by l.id for update of l;
  for v_action in select * from public.actions where change_set_id=p_change_set_id order by position loop
    if v_action.type::text in ('write_line','revise_line') then
      if nullif(btrim(v_action.input->>'content'),'') is null
        or jsonb_typeof(v_action.input->'unitRevisionIds') is distinct from 'array'
        or jsonb_array_length(v_action.input->'unitRevisionIds')=0 then
        raise exception 'Each text patch must retain supported text and citations';
      end if;
      if exists(select 1 from jsonb_array_elements_text(v_action.input->'unitRevisionIds') cite
        where not exists(select 1 from jsonb_array_elements(p_evidence) evidence where evidence->>'revisionId'=cite)) then
        raise exception 'A patch citation is outside its evidence snapshot';
      end if;
    end if;
    if v_action.type::text='write_line' then
      select * into section from public.sections where id=(v_action.input->>'sectionId')::uuid;
    else
      select * into line from public.lines where id=v_action.target_id;
      if line.id is null or line.retired_at is not null or line.current_revision_id is distinct from (v_action.input->>'expectedLineRevisionId')::uuid then
        raise exception 'A paragraph changed while these edits were drafted. Run the update again.';
      end if;
      if (select author from public.line_revisions where id=line.current_revision_id) is distinct from 'ai'::public.actor_kind then
        raise exception 'Text patches cannot overwrite handwritten paragraphs';
      end if;
      select * into section from public.sections where id=line.section_id;
    end if;
    if section.id is null or section.retired_at is not null or section.mode<>'generated' then raise exception 'The edited section is no longer available'; end if;
  end loop;
  result:=public.commit_change_set(p_change_set_id);
  if result->>'status' is distinct from 'applied' then
    raise exception 'The text edits could not all be applied; no patches were saved';
  end if;
  return result;
end $$;
revoke all on function public.commit_text_patch_set(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.commit_text_patch_set(uuid,jsonb) to service_role;
revoke all on function public.read_section_state(uuid) from public,anon,authenticated;
grant execute on function public.read_section_state(uuid) to service_role;
notify pgrst,'reload schema';

-- Preserve workflow leases, replay protection and cancellation fencing.
create or replace function public.upload_workflow_write(p_event_id uuid,p_token uuid,p_key text,p_function text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare saved public.upload_writes; proc record; declarations text; arguments text; answer jsonb; cs public.change_sets; origin public.shift_events;
begin
 perform public.assert_upload_lease(p_event_id,p_token);
 if p_function not in ('submit_change_set','commit_change_set','commit_text_patch_set','complete_page_review') then raise exception 'Unsupported workflow write'; end if;
 select * into saved from public.upload_writes where event_id=p_event_id and key=p_key;
 if found then
   if saved.function_name<>p_function then raise exception 'Workflow operation key reused'; end if;
   return saved.result;
 end if;
 if p_function='submit_change_set' and p_key='reconcile:submit' then
   select c.* into cs from public.change_sets c join public.upload_workflows w on w.change_set_id=c.id where w.event_id=p_event_id;
   if found then answer:=jsonb_build_object('changeSetId',cs.id,'eventId',cs.event_id); end if;
 end if;
 if p_function in ('commit_change_set','commit_text_patch_set') then
   if not exists(select 1 from public.upload_workflows where event_id=p_event_id and change_set_id=(p_args->>'p_change_set_id')::uuid)
     and not exists(select 1 from public.upload_writes where event_id=p_event_id and function_name='submit_change_set'
       and result->>'changeSetId'=p_args->>'p_change_set_id') then raise exception 'Change set does not belong to this workflow'; end if;
   select * into cs from public.change_sets where id=(p_args->>'p_change_set_id')::uuid for update;
   if cs.status<>'draft' then answer:=change_control.commit_summary(cs.id,cs.status); end if;
 end if;
 if answer is null then
   select * into origin from public.shift_events where id=p_event_id;
   -- Preserve the original initiating person on AI continuations, even when a
   -- different person resumes the work. Approval answers retain their own actor.
   perform set_config('request.headers', (coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb
     || jsonb_build_object('x-person-id',origin.person_id,'x-via',origin.via))::text,true);
   select p.* into strict proc from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname=p_function and p.prokind='f';
   select string_agg(format('%I %s',proc.proargnames[i],pg_catalog.format_type(proc.proargtypes[i-1],null)),',' order by i),
     string_agg(format('%I => a.%I',proc.proargnames[i],proc.proargnames[i]),',' order by i)
     into declarations,arguments from generate_series(1,proc.pronargs) i where p_args ? proc.proargnames[i];
   execute format('select to_jsonb(public.%I(%s)) from jsonb_to_record($1) as a(%s)',p_function,arguments,declarations) into answer using p_args;
 end if;
 insert into public.upload_writes(event_id,key,function_name,result) values(p_event_id,p_key,p_function,answer);
 if p_key='reconcile:submit' then update public.upload_workflows set change_set_id=(answer->>'changeSetId')::uuid where event_id=p_event_id; end if;
 return answer;
end $$;

create or replace function public.section_build_write(p_section_id uuid,p_token timestamptz,p_function text,p_args jsonb)
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
    when 'commit_text_patch_set' then return public.commit_text_patch_set((p_args->>'p_change_set_id')::uuid,p_args->'p_evidence');
    when 'commit_change_set' then return public.commit_change_set((p_args->>'p_change_set_id')::uuid);
    when 'auto_accept_exceptions' then return public.auto_accept_exceptions(p_args->>'p_role',(p_args->>'p_change_set_id')::uuid);
    when 'upload_workflow_write' then return public.upload_workflow_write((p_args->>'p_event_id')::uuid,(p_args->>'p_token')::uuid,p_args->>'p_key',p_args->>'p_function',p_args->'p_args');
    when 'finish_section_build' then return public.finish_section_build(p_section_id,(p_args->>'p_event_id')::uuid,p_args->>'p_model_version',(p_args->>'p_changed')::boolean);
    when 'mark_section_stale' then return public.mark_section_stale(p_section_id);
    else raise exception 'Unsupported section build operation.';
  end case;
end $$;
