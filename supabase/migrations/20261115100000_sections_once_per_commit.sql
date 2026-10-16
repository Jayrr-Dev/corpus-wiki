-- =====================================================================
-- SECTIONS ONCE PER COMMIT. Every claim a commit saves ran
-- project_knowledge_context, which found the claim's sections before and
-- after its entities were re-projected. Even as one query per claim
-- (20261114100000) that grew with the file: 100 steps took 16 s, past the
-- 8 s statement timeout; with the section work removed the same commit
-- took 1.2 s. A commit now finds sections once:
--   start   the sections that show the claims it will revise or merge
--           (their old sections), in one pass over the generated sections
--   apply   each claim re-projects its entities and is noted; nothing scans
--   end     one pass finds the sections that show any noted claim now;
--           old and new sections go stale and are recorded on the actions
--           (undo_state.contextSectionIds), as before
-- Outside a commit (undo, accepting an exception) a claim still finds its
-- sections at once, through project_knowledge_context_now.
-- =====================================================================

alter function change_control.project_knowledge_context(uuid) rename to project_knowledge_context_now;

-- PROJECTION: inside a commit, re-project entities and note the claim; otherwise as before
create function change_control.project_knowledge_context(p_unit uuid)
returns uuid[]
language plpgsql
set search_path = ''
as $$
declare
  c jsonb;
  old_sections uuid[];
  section_id uuid;
  affected uuid[] := '{}';
begin
  if coalesce(current_setting('change_control.section_pass', true), '') <> 'deferred' then
    return change_control.project_knowledge_context_now(p_unit);
  end if;
  select r.knowledge_context into c from public.units u join public.revisions r on r.id = u.current_revision_id where u.id = p_unit;
  if c is null then c := jsonb_build_object('entities', '[]'::jsonb); end if;
  -- Old sections: what the commit found at its start, plus the cheap per-claim rules
  select array_agg(distinct s.id) into old_sections from public.sections s where s.mode = 'generated' and (
    s.id::text in (select jsonb_array_elements_text(coalesce(current_setting('change_control.old_sections', true), '{}')::jsonb -> p_unit::text))
    or exists (select 1 from public.section_inputs si where si.section_id = s.id and si.unit_id = p_unit)
    or exists (select 1 from public.revisions r cross join lateral jsonb_array_elements(coalesce(r.knowledge_context -> 'applicability' -> 'entities', '[]'::jsonb)) e
      where r.unit_id = p_unit and e ->> 'type' = s.query -> 'entity' ->> 'type' and e ->> 'key' = s.query -> 'entity' ->> 'key')
  );
  delete from public.unit_entities where unit_id = p_unit;
  insert into public.unit_entities (unit_id, entity_id, role)
  select distinct on (canonical) p_unit, canonical, role from (
    select public.entity_canonical_id(e.id) canonical, (x ->> 'role')::public.entity_role role,
      case x ->> 'role' when 'subject' then 0 when 'object' then 1 else 2 end strength
    from jsonb_array_elements(c -> 'entities') x join public.entities e on e.type = x ->> 'type' and e.key = x ->> 'key'
  ) links order by canonical, strength
  on conflict do nothing;
  foreach section_id in array coalesce(old_sections, '{}') loop
    perform public.mark_section_stale(section_id);
    affected := array_append(affected, section_id);
  end loop;
  -- New sections are found for every noted claim at the end of the commit
  perform set_config('change_control.section_units',
    coalesce(nullif(current_setting('change_control.section_units', true), '') || ',', '') || p_unit::text, true);
  return affected;
end $$;

-- COMMIT: the 20261104000000 commit, with the section passes around it
alter function public.commit_change_set(uuid) rename to commit_before_section_pass;
create function public.commit_change_set(p_change_set_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_targets uuid[];
  v_old jsonb := '{}';
  v_units uuid[];
  v_result jsonb;
  v_section public.sections;
  v_hit uuid[];
  v_unit uuid;
  v_by_unit jsonb := '{}';
begin
  -- START: the sections that show the claims this commit will revise or merge, in one pass
  select array_agg(distinct a.target_id) into v_targets from public.actions a
  where a.change_set_id = p_change_set_id and a.target_id is not null and a.type::text in ('revise_claim', 'merge_duplicates');
  if v_targets is not null then
    for v_section in select * from public.sections where mode = 'generated' and query is not null loop
      v_hit := array(select q.id from public.living_page_query_units(v_section.query) q(id) where q.id = any (v_targets));
      foreach v_unit in array v_hit loop
        v_old := jsonb_set(v_old, array[v_unit::text], coalesce(v_old -> v_unit::text, '[]') || to_jsonb(v_section.id));
      end loop;
    end loop;
  end if;
  perform set_config('change_control.section_pass', 'deferred', true);
  perform set_config('change_control.old_sections', v_old::text, true);
  perform set_config('change_control.section_units', '', true);

  v_result := public.commit_before_section_pass(p_change_set_id);

  -- END: the sections that show any claim the commit saved, in one pass
  v_units := array(select distinct x::uuid from unnest(string_to_array(nullif(current_setting('change_control.section_units', true), ''), ',')) x);
  perform set_config('change_control.section_pass', '', true);
  perform set_config('change_control.old_sections', '', true);
  perform set_config('change_control.section_units', '', true);
  if cardinality(v_units) > 0 then
    for v_section in select * from public.sections where mode = 'generated' and query is not null loop
      v_hit := array(select q.id from public.living_page_query_units(v_section.query) q(id) where q.id = any (v_units));
      if cardinality(v_hit) > 0 then
        perform public.mark_section_stale(v_section.id);
        foreach v_unit in array v_hit loop
          v_by_unit := jsonb_set(v_by_unit, array[v_unit::text], coalesce(v_by_unit -> v_unit::text, '[]') || to_jsonb(v_section.id));
        end loop;
      end if;
    end loop;
    -- Record them with each claim's action, beside its old sections (for rebuilds and undo)
    update public.actions a
    set undo_state = coalesce(a.undo_state, '{}') || jsonb_build_object('contextSectionIds',
      (select coalesce(jsonb_agg(distinct x), '[]') from (
        select jsonb_array_elements(coalesce(a.undo_state -> 'contextSectionIds', '[]')) x
        union all select jsonb_array_elements(v_by_unit -> a.target_id::text)) all_sections))
    where a.change_set_id = p_change_set_id and a.outcome = 'applied'
      and a.type::text in ('add_claim', 'revise_claim', 'merge_duplicates') and v_by_unit ? a.target_id::text;
  end if;
  return v_result;
end $$;

revoke all on function public.commit_change_set(uuid) from public, anon, authenticated;
grant execute on function public.commit_change_set(uuid) to service_role;
revoke all on function public.commit_before_section_pass(uuid) from public, anon, authenticated;
revoke execute on all functions in schema change_control from public, anon, authenticated;
