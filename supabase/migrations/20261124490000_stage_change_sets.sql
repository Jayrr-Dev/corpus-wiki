-- =====================================================================
-- ONE CHANGE SET PER STAGE PER UPLOAD (#49)
-- =====================================================================
-- An upload's automatic stages commit many small change sets (one per
-- section write), each checked and applied on its own so resume stays
-- idempotent. When the upload finishes, each foldable stage's change sets
-- become one: the first keeps its id and takes the others' actions, in
-- order, after its own. Actions keep their ids, checks, outcomes and undo
-- state, so Undo of the stage walks the same actions newest first, exactly
-- as undoing each change set newest first did.
--
-- Never folded (decisions people see keep their own entry and Undo):
--   person edits, sets with an Exception (open or answered), merges,
--   retirements of claims, entities, domains and pages, domain reviews,
--   approvals and source decisions, reverted sets, the upload's knowledge
--   set, and sets another table points at.
-- Folding writes change_sets, actions and upload_writes only, never units,
-- so the stale-mark triggers on units (#46) fire as before, Undo included.
-- B-tree indexes only (OrioleDB, AGENTS.md).
-- =====================================================================

-- THE STAGE a folded change set holds (null for every other change set)
alter table public.change_sets add column stage text;
comment on column public.change_sets.stage is 'Set when an upload''s automatic stage was folded into this one change set (#49).';

-- STAGES THAT FOLD, by the operation key's first part. The rest stay one set per
-- write: their code reads actions back by change set id, or they hold decisions.
create function change_control.upload_stage(p_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case split_part(p_key, ':', 1)
    when 'pages' then 'articles'
    when 'section' then 'articles'
  end
$$;

-- ONE LINE FOR THE CHANGES SCREEN, from what the stage's actions did
create function change_control.stage_summary(p_change_set_id uuid, p_stage text)
returns text
language sql
stable
set search_path = ''
as $$
  with counts as (
    select count(*) filter (where type::text = 'create_page') pages,
           count(*) filter (where type::text = 'create_section') sections,
           count(*) filter (where type::text in ('write_line', 'revise_line', 'retire_line', 'move_line')) lines,
           count(*) filter (where type::text not in ('create_page', 'create_section', 'write_line', 'revise_line', 'retire_line', 'move_line')) other
    from public.actions where change_set_id = p_change_set_id and outcome = 'applied'
  ), parts as (
    select array_remove(array[
      case when pages > 0 then pages || ' new article' || case when pages = 1 then '' else 's' end end,
      case when sections > 0 then sections || ' new section' || case when sections = 1 then '' else 's' end end,
      case when lines > 0 then lines || ' line change' || case when lines = 1 then '' else 's' end end,
      case when other > 0 then other || ' other change' || case when other = 1 then '' else 's' end end
    ], null) list from counts
  )
  select case p_stage when 'articles' then 'Wrote articles' else 'Upload stage ' || p_stage end
    || case when cardinality(list) > 0 then ': ' || array_to_string(list, ', ') else '' end
  from parts
$$;

-- FOLD: one change set per foldable stage of an upload; returns how many sets it folded away.
-- Safe to run again: a later write of a folded stage joins that stage's set.
create function change_control.fold_upload_stages(p_event_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  grp record;
  target uuid;
  member uuid;
  shift integer;
  folded integer := 0;
begin
  for grp in
    with members as (
      select distinct c.id, c.created_at, c.space_id, c.proposed_by, c.author_id, c.actor_attribution::text attribution,
             change_control.upload_stage(w.key) stage
      from public.upload_writes w
      join public.change_sets c on c.id = (w.result ->> 'changeSetId')::uuid
      where w.event_id = p_event_id and w.function_name = 'submit_change_set'
        and change_control.upload_stage(w.key) is not null
        and c.event_id = p_event_id and c.proposed_by = 'ai' and c.status in ('applied', 'partly_applied')
        and not exists (select 1 from public.upload_workflows u where u.change_set_id = c.id)
        and not exists (select 1 from public.root_approval_jobs j where j.change_set_id = c.id)
        and not exists (select 1 from public.article_reviews r where r.change_set_id = c.id)
        and not exists (select 1 from public.page_review_runs r where r.change_set_id = c.id)
        and not exists (
          select 1 from public.actions a where a.change_set_id = c.id and (
            a.outcome in ('exception', 'reverted') or a.reverted_by_event_id is not null
            or a.input ->> 'domainReview' = 'true'
            or a.type::text in ('merge_duplicates', 'merge_entity', 'retire_claim', 'retire_entity', 'retire_domain', 'retire_page',
                                'source_lifecycle', 'source_review', 'review_page', 'approve_reviewer_budget')
            or exists (select 1 from public.exceptions x where x.action_id = a.id)))
    )
    select m.stage, array_agg(m.id order by m.created_at, m.id) ids
    from members m
    group by m.space_id, m.stage, m.proposed_by, m.author_id, m.attribution
    having count(*) > 1
  loop
    perform 1 from public.change_sets where id = any (grp.ids) order by id for update;
    target := grp.ids[1];
    update public.change_sets t set
      stage = grp.stage,
      tokens_in = s.tokens_in, tokens_out = s.tokens_out,
      model_version = s.model_version, prompt_version = s.prompt_version,
      applied_at = s.applied_at,
      status = s.status
    from (
      select sum(tokens_in)::integer tokens_in, sum(tokens_out)::integer tokens_out,
             case when count(distinct model_version) = 1 then max(model_version) end model_version,
             case when count(distinct prompt_version) = 1 then max(prompt_version) end prompt_version,
             max(applied_at) applied_at,
             (case when bool_and(status = 'applied') then 'applied' else 'partly_applied' end)::public.change_set_status status
      from public.change_sets where id = any (grp.ids)
    ) s
    where t.id = target;
    foreach member in array grp.ids[2:] loop
      select coalesce(max(position), -1) + 1 into shift from public.actions where change_set_id = target;
      update public.actions set change_set_id = target, position = position + shift where change_set_id = member;
      -- A resumed write replays its saved answer, which now names the stage's set
      update public.upload_writes set result = jsonb_set(result, '{changeSetId}', to_jsonb(target::text))
      where event_id = p_event_id and result ->> 'changeSetId' = member::text;
      delete from public.change_sets where id = member;
      folded := folded + 1;
    end loop;
    update public.change_sets set summary = change_control.stage_summary(target, grp.stage) where id = target;
  end loop;
  return folded;
end $$;

-- WHEN: the moment an upload's processing completes
create function change_control.fold_completed_upload()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform change_control.fold_upload_stages(new.event_id);
  return null;
end $$;
create trigger fold_upload_stages after update of state on public.upload_workflows
for each row when (new.state = 'complete' and old.state is distinct from 'complete')
execute function change_control.fold_completed_upload();

revoke execute on function change_control.upload_stage(text), change_control.stage_summary(uuid, text),
  change_control.fold_upload_stages(uuid), change_control.fold_completed_upload() from public, anon, authenticated;
-- Uploads release their workflow as space_runtime; the trigger runs as that role
grant execute on function change_control.upload_stage(text), change_control.stage_summary(uuid, text),
  change_control.fold_upload_stages(uuid), change_control.fold_completed_upload() to space_runtime, service_role;
notify pgrst, 'reload schema';
