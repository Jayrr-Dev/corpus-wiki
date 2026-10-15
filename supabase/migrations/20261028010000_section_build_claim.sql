-- =====================================================================
-- SECOND BRAIN · ONE BUILD PER SECTION AT A TIME
-- =====================================================================
-- Two events touching the same section used to rebuild it at once. Both
-- read the same lines; the first committed, the second's actions no
-- longer matched and were refused, and its failure put the section back
-- to 'stale' with nothing left to rebuild it.
--
-- Now a build CLAIMS the section first. A caller that finds it already
-- building records that another rebuild is wanted (and for which event)
-- and returns; the build holding the claim sees that when it finishes and
-- runs once more against the newest claims. A claim older than 15 minutes
-- is treated as abandoned (the process died) and can be taken over.
-- =====================================================================

alter table public.sections
  add column building_since timestamptz,
  add column rebuild_requested boolean not null default false,
  add column rebuild_event_id uuid references public.shift_events (id) on delete set null;
comment on column public.sections.building_since is 'When the running build claimed this section. Null when not building.';
comment on column public.sections.rebuild_requested is 'Set when a rebuild was asked for while another was running; that build runs again when it finishes.';
comment on column public.sections.rebuild_event_id is 'The event behind the waiting rebuild, for its change note.';

-- CLAIM A BUILD: marks the section building unless a live build holds it.
-- Returns { sectionId, claimed }
create function public.claim_section_build(p_section_id uuid, p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.sections
  set status = 'building', building_since = now(), rebuild_requested = false, rebuild_event_id = null
  where id = p_section_id
    and (status <> 'building' or building_since is null or building_since < now() - interval '15 minutes');
  if found then return jsonb_build_object('sectionId', p_section_id, 'claimed', true); end if;
  update public.sections
  set rebuild_requested = true, rebuild_event_id = coalesce(p_event_id, rebuild_event_id)
  where id = p_section_id;
  if not found then raise exception 'Section % does not exist.', p_section_id; end if;
  return jsonb_build_object('sectionId', p_section_id, 'claimed', false);
end $$;

-- SAVE A BUILD: as before, plus releases the claim and says whether another rebuild is waiting.
-- Returns { sectionId, changeNoteId, rebuildRequested, rebuildEventId }
create or replace function public.finish_section_build(p_section_id uuid, p_event_id uuid, p_model_version text, p_changed boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note_id uuid;
  v_requested boolean;
  v_requested_event uuid;
begin
  update public.sections
  set status = 'current', built_at = now(), building_since = null,
      built_with_model_version = coalesce(p_model_version, built_with_model_version)
  where id = p_section_id
  returning rebuild_requested, rebuild_event_id into v_requested, v_requested_event;
  if not found then raise exception 'Section % does not exist.', p_section_id; end if;
  if p_event_id is not null and p_changed then
    insert into public.change_notes (section_id, event_id, summary)
    values (p_section_id, p_event_id, public.living_page_change_summary(p_event_id,
      array(select unit_id from public.section_inputs where section_id = p_section_id
            union select public.living_page_event_units(p_event_id))))
    returning id into v_note_id;
  end if;
  return jsonb_build_object('sectionId', p_section_id, 'changeNoteId', v_note_id,
    'rebuildRequested', v_requested, 'rebuildEventId', v_requested_event);
end $$;

-- A FAILED BUILD: the section goes back to stale and the claim is released
create or replace function public.mark_section_stale(p_section_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  update public.sections set status = 'stale', building_since = null where id = p_section_id
  returning jsonb_build_object('sectionId', id, 'status', status);
$$;

revoke execute on function public.claim_section_build(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_section_build(uuid, uuid) to service_role;
