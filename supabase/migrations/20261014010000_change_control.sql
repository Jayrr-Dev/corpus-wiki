-- =====================================================================
-- SECOND BRAIN · CHANGE CONTROL (AGENT B)
-- =====================================================================
-- The one writer of the knowledge store. A ChangeSet is stored as a
-- draft first (the model call happens before, so locks stay short), then
-- commit_change_set checks and applies its actions in one transaction.
--
-- Public entry points (server code calls them with the secret key):
--   submit_change_set   store a drafted ChangeSet and its actions
--   commit_change_set   check every action, apply, hold or reject it
--   revert_change_set   undo an applied ChangeSet
--   resolve_exception   a person's Accept or Reject on an exception
-- Internals live in the `change_control` schema, which the Data API
-- does not expose.
--
-- CONVENTIONS (settles the foundation's open points 1 and 3)
--   * Entities and domains are referenced by natural key / path, so an
--     action can use what an earlier action in the same ChangeSet creates.
--   * A `link` may point at a unit an earlier action created: input
--     `fromPosition` / `toPosition` (that action's position) instead of
--     target_id / toUnitId.
--   * An applied create (create_domain, create_entity, add_claim) records
--     the row it created in target_id.
-- =====================================================================


-- =====================================================================
-- UNDO STATE: what undo restores for one applied action
-- (prior unit fields, the relationship a link created, whether a create
-- made a new row). Revisions themselves are never edited.
-- =====================================================================

alter table public.actions add column undo_state jsonb;
comment on column public.actions.undo_state is 'What undo restores: prior unit fields, created relationship id, or whether a create made a new row.';

create schema if not exists change_control;
revoke all on schema change_control from public, anon, authenticated;


-- =====================================================================
-- HELPERS: small lookups used by the checks and the writers
-- =====================================================================

-- NEWEST SOURCE DATE BEHIND A SET OF PASSAGES (null when there are none)
create function change_control.passages_source_date(p_passage_ids uuid[])
returns timestamptz
language sql stable
set search_path = ''
as $$
  select max(s.source_date)
  from public.passages p join public.sources s on s.id = p.source_id
  where p.id = any (p_passage_ids)
$$;

-- FIRST PASSAGE'S TEXT, SHORTENED: the evidence quote shown on an exception
create function change_control.evidence_quote(p_passage_ids uuid[])
returns text
language sql stable
set search_path = ''
as $$
  select left(p.text, 300)
  from public.passages p
  where p.id = any (p_passage_ids) and p.text !~ '^\s*(#|Date:)'
  order by p.position
  limit 1
$$;

-- A UUID ARRAY FROM A JSONB ARRAY OF STRINGS
create function change_control.uuid_array(p_value jsonb)
returns uuid[]
language sql immutable
set search_path = ''
as $$
  select coalesce(array_agg(v::uuid), '{}') from jsonb_array_elements_text(coalesce(p_value, '[]')) v
$$;

-- THE UNIT AN EARLIER ACTION OF THE SAME CHANGESET CREATED (forward reference)
create function change_control.unit_at_position(p_change_set_id uuid, p_position integer)
returns uuid
language sql stable
set search_path = ''
as $$
  select target_id from public.actions
  where change_set_id = p_change_set_id and position = p_position and outcome = 'applied'
$$;

-- ONE CHECK RESULT ({ name, passed, detail }) for actions.check_results
create function change_control.check(p_name text, p_passed boolean, p_detail text)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_build_object('name', p_name, 'passed', p_passed, 'detail', p_detail)
$$;


-- =====================================================================
-- CHECKS: decide each action's fate before anything is written.
-- Returns { outcome: applied|exception|rejected, reason?, checks: [...] }.
-- Only these checks can stop the AI; everything they pass is applied
-- without asking (approval by exception).
-- =====================================================================

-- TARGET UNIT: must exist and be current for every action that changes one
create function change_control.check_target(p_action public.actions)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_unit public.units;
begin
  if p_action.type not in ('revise_claim', 'retire_claim', 'set_epistemic_status', 'merge_duplicates') then
    return null;
  end if;
  select * into v_unit from public.units where id = p_action.target_id;
  if v_unit.id is null then
    return change_control.check('target', false, 'The unit does not exist.');
  end if;
  if v_unit.retired_at is not null then
    return change_control.check('target', false, 'The unit is retired.');
  end if;
  return change_control.check('target', true, null);
end $$;

-- SOURCE DATE (axiom: the newer source wins). Only for AI revisions with evidence:
-- older than the unit's current revision = rejected; same date, different
-- content = a tie only a person can break; same date, same content = more evidence.
create function change_control.check_source_date(p_action public.actions, p_proposed_by public.actor_kind)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_current public.revisions;
  v_new_date timestamptz := change_control.passages_source_date(p_action.passage_ids);
begin
  if p_action.type <> 'revise_claim' or p_proposed_by <> 'ai' or v_new_date is null then
    return null;
  end if;
  select r.* into v_current from public.units u join public.revisions r on r.id = u.current_revision_id
  where u.id = p_action.target_id;
  if v_new_date < v_current.source_date then
    return change_control.check('source_date', false, 'The file is older than the unit''s current source.');
  end if;
  if v_new_date = v_current.source_date and v_current.content <> p_action.input ->> 'content' then
    return change_control.check('source_tie', false, 'Two sources of the same date disagree.');
  end if;
  return change_control.check('source_date', true, null);
end $$;

-- DECISION CONFLICT: a proposal or a question may not overwrite a decision
create function change_control.check_decision(p_action public.actions)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_kind public.unit_kind;
begin
  if p_action.type <> 'revise_claim' or p_action.speech_act is null or p_action.speech_act not in ('proposed', 'asked') then
    return null;
  end if;
  select kind into v_kind from public.units where id = p_action.target_id;
  if v_kind = 'decision' then
    return change_control.check('decision', false, 'A proposal would overwrite a decision.');
  end if;
  return change_control.check('decision', true, null);
end $$;

-- DELETION: the AI may propose retiring a unit, but a person confirms it
create function change_control.check_deletion(p_action public.actions, p_proposed_by public.actor_kind)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select case when p_action.type in ('retire_claim', 'merge_duplicates') and p_proposed_by = 'ai'
    then change_control.check('deletion', false, 'The AI wants to retire knowledge.') end
$$;

-- REFERENCES: entities (type, key) and domain paths an add_claim names must exist by now
create function change_control.check_references(p_action public.actions)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_missing text;
begin
  if p_action.type <> 'add_claim' then
    return null;
  end if;
  select string_agg(e ->> 'type' || ':' || (e ->> 'key'), ', ') into v_missing
  from jsonb_array_elements(coalesce(p_action.input -> 'entities', '[]')) e
  where not exists (select 1 from public.entities x where x.type = e ->> 'type' and x.key = e ->> 'key');
  if v_missing is null then
    select string_agg(d, ', ') into v_missing
    from jsonb_array_elements_text(coalesce(p_action.input -> 'domainPaths', '[]')) d
    where not exists (select 1 from public.domains x where x.path = d);
  end if;
  return change_control.check('references', v_missing is null, case when v_missing is not null then 'Unknown: ' || v_missing end);
end $$;

-- ALL CHECKS FOR ONE ACTION, folded into one verdict
create function change_control.judge(p_action public.actions, p_proposed_by public.actor_kind)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_checks jsonb := '[]';
  v_check jsonb;
  v_outcome text := 'applied';
  v_reason text;
  v_detail text;
begin
  foreach v_check in array array[
    change_control.check_target(p_action),
    change_control.check_references(p_action),
    change_control.check_source_date(p_action, p_proposed_by),
    change_control.check_decision(p_action),
    change_control.check_deletion(p_action, p_proposed_by)
  ] loop
    continue when v_check is null;
    v_checks := v_checks || v_check;
    continue when (v_check ->> 'passed')::boolean or v_outcome = 'rejected';
    v_detail := v_check ->> 'detail';
    -- A failed target, reference or date check rejects; the rest ask a person
    case v_check ->> 'name'
      when 'source_tie' then v_outcome := 'exception'; v_reason := 'source_tie';
      when 'decision' then v_outcome := 'exception'; v_reason := 'decision_conflict';
      when 'deletion' then v_outcome := 'exception'; v_reason := 'deletion';
      else v_outcome := 'rejected'; v_reason := null;
    end case;
  end loop;
  return jsonb_build_object('outcome', v_outcome, 'reason', v_reason, 'detail', v_detail, 'checks', v_checks);
end $$;


-- =====================================================================
-- WRITERS: one per action type. Each writes the store, then records on
-- the action what it changed (target_id, revisions, undo_state).
-- =====================================================================

-- CREATE DOMAIN: under its parent path; an existing path is reused, not duplicated
create function change_control.apply_create_domain(p_action public.actions, p_author public.actor_kind)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_path text := p_action.input ->> 'path';
  v_id uuid;
  v_parent_id uuid;
begin
  select id into v_id from public.domains where path = v_path;
  if v_id is null then
    select id into v_parent_id from public.domains where path = p_action.input ->> 'parentPath';
    insert into public.domains (name, parent_id, path, proposed_by)
    values (p_action.input ->> 'name', v_parent_id, v_path, p_author)
    returning id into v_id;
    update public.actions set undo_state = '{"created": true}' where id = p_action.id;
  else
    update public.actions set undo_state = '{"created": false}' where id = p_action.id;
  end if;
  update public.actions set target_id = v_id where id = p_action.id;
end $$;

-- CREATE ENTITY: (type, key) is unique, so an existing entity is reused
create function change_control.apply_create_entity(p_action public.actions)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_created boolean;
begin
  insert into public.entities (type, key, name, aliases)
  values (
    p_action.input ->> 'type', p_action.input ->> 'key', p_action.input ->> 'name',
    array(select jsonb_array_elements_text(coalesce(p_action.input -> 'aliases', '[]')))
  )
  on conflict (type, key) do nothing
  returning id into v_id;
  v_created := v_id is not null;
  if not v_created then
    select id into v_id from public.entities where type = p_action.input ->> 'type' and key = p_action.input ->> 'key';
  end if;
  update public.actions
  set target_id = v_id, undo_state = jsonb_build_object('created', v_created)
  where id = p_action.id;
end $$;

-- ADD CLAIM: a new unit, its first revision, and what it is about / where it belongs
create function change_control.apply_add_claim(p_action public.actions, p_event_id uuid, p_author public.actor_kind)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_unit_id uuid := gen_random_uuid();
  v_revision_id uuid := gen_random_uuid();
  v_source_date timestamptz := coalesce(change_control.passages_source_date(p_action.passage_ids), now());
begin
  insert into public.units (id, kind, epistemic_status, current_revision_id, valid_from)
  values (
    v_unit_id, (p_action.input ->> 'kind')::public.unit_kind,
    (p_action.input ->> 'epistemicStatus')::public.epistemic_status, v_revision_id,
    coalesce((p_action.input ->> 'validFrom')::timestamptz, v_source_date)
  );
  insert into public.revisions (id, unit_id, content, passage_ids, source_date, event_id, author)
  values (v_revision_id, v_unit_id, p_action.input ->> 'content', p_action.passage_ids, v_source_date, p_event_id, p_author);
  insert into public.unit_entities (unit_id, entity_id, role)
  select v_unit_id, x.id, (e ->> 'role')::public.entity_role
  from jsonb_array_elements(coalesce(p_action.input -> 'entities', '[]')) e
  join public.entities x on x.type = e ->> 'type' and x.key = e ->> 'key'
  on conflict do nothing;
  insert into public.unit_domains (unit_id, domain_id)
  select v_unit_id, x.id
  from jsonb_array_elements_text(coalesce(p_action.input -> 'domainPaths', '[]')) d
  join public.domains x on x.path = d
  on conflict do nothing;
  update public.actions
  set target_id = v_unit_id, after_revision_id = v_revision_id, undo_state = '{}'
  where id = p_action.id;
end $$;

-- REVISE CLAIM: a new revision replaces the current one (the old one is kept)
create function change_control.apply_revise_claim(p_action public.actions, p_event_id uuid, p_author public.actor_kind)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_unit public.units;
  v_revision_id uuid;
begin
  select * into v_unit from public.units where id = p_action.target_id for update;
  insert into public.revisions (unit_id, content, replaces_revision_id, passage_ids, source_date, event_id, author)
  values (
    v_unit.id, p_action.input ->> 'content', v_unit.current_revision_id, p_action.passage_ids,
    coalesce(change_control.passages_source_date(p_action.passage_ids), now()), p_event_id, p_author
  )
  returning id into v_revision_id;
  update public.units set
    current_revision_id = v_revision_id,
    epistemic_status = coalesce((p_action.input ->> 'epistemicStatus')::public.epistemic_status, epistemic_status),
    valid_from = coalesce((p_action.input ->> 'validFrom')::timestamptz, valid_from),
    last_changed_at = now()
  where id = v_unit.id;
  update public.actions set
    before_revision_id = v_unit.current_revision_id, after_revision_id = v_revision_id,
    undo_state = jsonb_build_object('epistemicStatus', v_unit.epistemic_status, 'validFrom', v_unit.valid_from)
  where id = p_action.id;
end $$;

-- RETIRE CLAIM: leaves the page, stays in history ("delete" for knowledge)
create function change_control.apply_retire_claim(p_action public.actions)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_unit public.units;
begin
  select * into v_unit from public.units where id = p_action.target_id for update;
  update public.units
  set retired_at = now(), valid_to = (p_action.input ->> 'validTo')::timestamptz, last_changed_at = now()
  where id = v_unit.id;
  update public.actions set
    before_revision_id = v_unit.current_revision_id,
    undo_state = jsonb_build_object('validTo', v_unit.valid_to)
  where id = p_action.id;
end $$;

-- SET EPISTEMIC STATUS: how certain the unit is (axiom 7)
create function change_control.apply_set_epistemic_status(p_action public.actions)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_unit public.units;
begin
  select * into v_unit from public.units where id = p_action.target_id for update;
  update public.units
  set epistemic_status = (p_action.input ->> 'epistemicStatus')::public.epistemic_status, last_changed_at = now()
  where id = v_unit.id;
  update public.actions
  set before_revision_id = v_unit.current_revision_id, undo_state = jsonb_build_object('epistemicStatus', v_unit.epistemic_status)
  where id = p_action.id;
end $$;

-- LINK: a typed relationship between two units (either may be created earlier in the set)
create function change_control.apply_link(p_action public.actions, p_event_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_from uuid := coalesce(p_action.target_id,
    change_control.unit_at_position(p_action.change_set_id, (p_action.input ->> 'fromPosition')::integer));
  v_to uuid := coalesce((p_action.input ->> 'toUnitId')::uuid,
    change_control.unit_at_position(p_action.change_set_id, (p_action.input ->> 'toPosition')::integer));
  v_relationship_id uuid;
begin
  insert into public.relationships (from_unit_id, to_unit_id, type, event_id)
  values (v_from, v_to, (p_action.input ->> 'type')::public.relationship_type, p_event_id)
  returning id into v_relationship_id;
  update public.actions
  set target_id = v_from, undo_state = jsonb_build_object('relationshipId', v_relationship_id)
  where id = p_action.id;
end $$;

-- MERGE DUPLICATES: keeps the target, retires the duplicates
create function change_control.apply_merge_duplicates(p_action public.actions)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_duplicates uuid[] := change_control.uuid_array(p_action.input -> 'duplicateUnitIds');
begin
  update public.units set retired_at = now(), last_changed_at = now()
  where id = any (v_duplicates) and retired_at is null and id <> p_action.target_id;
  update public.actions set undo_state = jsonb_build_object('retiredUnitIds', to_jsonb(v_duplicates))
  where id = p_action.id;
end $$;

-- APPLY ONE ACTION (already judged) and mark it applied
create function change_control.apply_action(p_action public.actions, p_event_id uuid, p_author public.actor_kind)
returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_action.type
    when 'create_domain' then perform change_control.apply_create_domain(p_action, p_author);
    when 'create_entity' then perform change_control.apply_create_entity(p_action);
    when 'add_claim' then perform change_control.apply_add_claim(p_action, p_event_id, p_author);
    when 'revise_claim' then perform change_control.apply_revise_claim(p_action, p_event_id, p_author);
    when 'retire_claim' then perform change_control.apply_retire_claim(p_action);
    when 'set_epistemic_status' then perform change_control.apply_set_epistemic_status(p_action);
    when 'link' then perform change_control.apply_link(p_action, p_event_id);
    when 'merge_duplicates' then perform change_control.apply_merge_duplicates(p_action);
  end case;
  update public.actions set outcome = 'applied', applied_at = now() where id = p_action.id;
end $$;


-- =====================================================================
-- EXCEPTIONS: questions for the person
-- =====================================================================

-- HOLD AN ACTION FOR A PERSON, with the evidence they need to decide
create function change_control.raise_exception(p_action public.actions, p_reason public.exception_reason, p_detail text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.actions set outcome = 'exception' where id = p_action.id;
  insert into public.exceptions (action_id, reason, evidence)
  values (
    p_action.id, p_reason,
    jsonb_build_object(
      'quote', change_control.evidence_quote(p_action.passage_ids),
      'passageIds', to_jsonb(p_action.passage_ids),
      'detail', p_detail
    )
  );
end $$;

-- DOMAIN TREE REVIEW: the first time the AI drafts domains, the person reviews the tree once
create function change_control.raise_domain_review(p_change_set_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_first_action uuid;
  v_paths jsonb;
begin
  if exists (select 1 from public.exceptions where reason = 'domain_tree_review') then
    return;
  end if;
  select (array_agg(a.id order by a.position))[1], jsonb_agg(a.input ->> 'path' order by a.position)
  into v_first_action, v_paths
  from public.actions a join public.change_sets cs on cs.id = a.change_set_id
  where a.change_set_id = p_change_set_id and a.type = 'create_domain' and a.outcome = 'applied'
    and (a.undo_state ->> 'created')::boolean and cs.proposed_by = 'ai';
  if v_first_action is not null then
    insert into public.exceptions (action_id, reason, evidence)
    values (v_first_action, 'domain_tree_review',
      jsonb_build_object('domainPaths', v_paths, 'detail', 'The AI drafted these domains. Keep them?'));
  end if;
end $$;


-- =====================================================================
-- STATUS: a ChangeSet's status from its actions, mirrored on its event
-- =====================================================================

-- applied = every action applied; rejected = nothing applied or held; else partly_applied
create function change_control.refresh_status(p_change_set_id uuid)
returns public.change_set_status
language plpgsql
set search_path = ''
as $$
declare
  v_total integer;
  v_applied integer;
  v_held integer;
  v_status public.change_set_status;
begin
  select count(*), count(*) filter (where outcome = 'applied'), count(*) filter (where outcome = 'exception')
  into v_total, v_applied, v_held
  from public.actions where change_set_id = p_change_set_id;
  v_status := case
    when v_applied = v_total then 'applied'
    when v_applied = 0 and v_held = 0 then 'rejected'
    else 'partly_applied'
  end;
  update public.change_sets
  set status = v_status, applied_at = case when v_applied > 0 then coalesce(applied_at, now()) end
  where id = p_change_set_id;
  -- The event finished either way; a rejected set (e.g. an older file) simply changed nothing
  update public.shift_events
  set status = case when v_status = 'partly_applied' then 'partly_applied' else 'applied' end::public.event_status,
      finished_at = now()
  where id = (select event_id from public.change_sets where id = p_change_set_id);
  return v_status;
end $$;


-- =====================================================================
-- PUBLIC: SUBMIT A DRAFT CHANGESET
-- p_actions: [{ type, targetId, expectedRevisionId, input, passageIds, speechAct }]
-- (lib/ai/types.ts DraftAction). Creates the event when p_event_id is null
-- (a person's edit). Returns { changeSetId, eventId }.
-- =====================================================================

create function public.submit_change_set(
  p_event_id uuid,
  p_cause public.event_cause,
  p_actor public.actor_kind,
  p_summary text,
  p_trace jsonb,
  p_actions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid := p_event_id;
  v_change_set_id uuid;
begin
  if v_event_id is null then
    insert into public.shift_events (cause, actor, status) values (p_cause, p_actor, 'checking')
    returning id into v_event_id;
  else
    update public.shift_events set status = 'checking' where id = v_event_id;
  end if;
  insert into public.change_sets (event_id, proposed_by, summary, model_version, prompt_version, tokens_in, tokens_out)
  values (v_event_id, p_actor, p_summary, p_trace ->> 'modelVersion', p_trace ->> 'promptVersion',
          (p_trace ->> 'tokensIn')::integer, (p_trace ->> 'tokensOut')::integer)
  returning id into v_change_set_id;
  insert into public.actions (change_set_id, position, type, target_id, expected_revision_id, input, passage_ids, speech_act)
  select v_change_set_id, (a.ordinality - 1)::integer, (a.value ->> 'type')::public.action_type,
         (a.value ->> 'targetId')::uuid, (a.value ->> 'expectedRevisionId')::uuid, a.value -> 'input',
         change_control.uuid_array(a.value -> 'passageIds'), (a.value ->> 'speechAct')::public.speech_act
  from jsonb_array_elements(coalesce(p_actions, '[]')) with ordinality a;
  return jsonb_build_object('changeSetId', v_change_set_id, 'eventId', v_event_id);
end $$;


-- =====================================================================
-- PUBLIC: COMMIT A CHANGESET
-- One transaction. Locks the units it touches and refuses the whole set
-- when any of them moved since it was drafted (expected revision). Then
-- judges and applies each action in position order, so later actions see
-- what earlier ones created. Returns { changeSetId, status, applied,
-- exceptions, rejected, eventStatus }.
-- =====================================================================

create function public.commit_change_set(p_change_set_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set public.change_sets;
  v_action public.actions;
  v_verdict jsonb;
  v_status public.change_set_status;
begin
  select * into v_set from public.change_sets where id = p_change_set_id for update;
  if v_set.id is null then raise exception 'ChangeSet % does not exist', p_change_set_id; end if;
  if v_set.status <> 'draft' then raise exception 'ChangeSet % is already %', p_change_set_id, v_set.status; end if;
  update public.change_sets set status = 'checking' where id = v_set.id;

  -- THE WORLD MOVED: a unit's current revision is no longer the one the drafter saw
  perform 1 from public.units u join public.actions a on a.target_id = u.id
  where a.change_set_id = v_set.id order by u.id for update of u;
  if exists (
    select 1 from public.actions a join public.units u on u.id = a.target_id
    where a.change_set_id = v_set.id and a.expected_revision_id is not null
      and u.current_revision_id <> a.expected_revision_id
  ) then
    return change_control.reject_moved(v_set);
  end if;

  -- JUDGE AND APPLY, IN ORDER
  for v_action in select * from public.actions where change_set_id = v_set.id order by position loop
    v_verdict := change_control.judge(v_action, v_set.proposed_by);
    update public.actions set check_results = v_verdict -> 'checks' where id = v_action.id;
    case v_verdict ->> 'outcome'
      when 'applied' then perform change_control.apply_action(v_action, v_set.event_id, v_set.proposed_by);
      when 'exception' then perform change_control.raise_exception(
        v_action, (v_verdict ->> 'reason')::public.exception_reason, v_verdict ->> 'detail');
      else update public.actions set outcome = 'rejected' where id = v_action.id;
    end case;
  end loop;

  perform change_control.raise_domain_review(v_set.id);
  v_status := change_control.refresh_status(v_set.id);
  return change_control.commit_summary(v_set.id, v_status);
end $$;

-- REJECT A WHOLE SET WHOSE UNITS MOVED (the caller drafts again from the new state)
create function change_control.reject_moved(p_set public.change_sets)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  update public.actions
  set outcome = 'rejected', check_results = jsonb_build_array(
    change_control.check('expected_revision', false, 'Knowledge changed while this was drafted.'))
  where change_set_id = p_set.id;
  update public.change_sets set status = 'rejected' where id = p_set.id;
  update public.shift_events
  set status = 'failed', error = 'Knowledge changed while this was being drafted. Try again.', finished_at = now()
  where id = p_set.event_id;
  return change_control.commit_summary(p_set.id, 'rejected');
end $$;

-- COUNTS RETURNED TO THE CALLER, plus the event's status after the commit
create function change_control.commit_summary(p_change_set_id uuid, p_status public.change_set_status)
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'changeSetId', p_change_set_id,
    'status', p_status,
    'applied', count(*) filter (where outcome = 'applied'),
    'exceptions', count(*) filter (where outcome = 'exception'),
    'rejected', count(*) filter (where outcome = 'rejected'),
    'eventStatus', (select ev.status from public.change_sets cs join public.shift_events ev on ev.id = cs.event_id
                    where cs.id = p_change_set_id)
  )
  from public.actions where change_set_id = p_change_set_id
$$;


-- =====================================================================
-- UNDO: reverses one applied action. Refuses when a later change edited
-- the same unit (undo that one first), so undo never loses newer work.
-- =====================================================================

-- A later change touched this action's unit?
create function change_control.unit_moved_since(p_action public.actions)
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1 from public.actions later
    where later.target_id = p_action.target_id and later.outcome = 'applied'
      and later.applied_at > p_action.applied_at and later.id <> p_action.id
      and p_action.type in ('add_claim', 'revise_claim', 'retire_claim', 'set_epistemic_status')
  )
$$;

-- A domain or entity a create made, deleted again only when nothing uses it
create function change_control.undo_create(p_action public.actions)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not coalesce((p_action.undo_state ->> 'created')::boolean, false) then
    return;
  end if;
  if p_action.type = 'create_domain'
     and not exists (select 1 from public.unit_domains where domain_id = p_action.target_id)
     and not exists (select 1 from public.domains where parent_id = p_action.target_id)
     and not exists (select 1 from public.pages where domain_id = p_action.target_id) then
    delete from public.domains where id = p_action.target_id;
  elsif p_action.type = 'create_entity'
     and not exists (select 1 from public.unit_entities where entity_id = p_action.target_id)
     and not exists (select 1 from public.pages where entity_id = p_action.target_id) then
    delete from public.entities where id = p_action.target_id;
  end if;
end $$;

-- THE INVERSE OF ONE APPLIED ACTION
create function change_control.undo_action(p_action public.actions, p_revert_event_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_state jsonb := coalesce(p_action.undo_state, '{}');
begin
  if change_control.unit_moved_since(p_action) then
    raise exception 'A later change edited the same knowledge. Undo that change first.';
  end if;
  case p_action.type
    when 'add_claim' then
      update public.units set retired_at = now(), last_changed_at = now() where id = p_action.target_id;
    when 'revise_claim' then
      update public.units set current_revision_id = p_action.before_revision_id,
        epistemic_status = (v_state ->> 'epistemicStatus')::public.epistemic_status,
        valid_from = (v_state ->> 'validFrom')::timestamptz, last_changed_at = now()
      where id = p_action.target_id;
    when 'retire_claim' then
      update public.units set retired_at = null, valid_to = (v_state ->> 'validTo')::timestamptz, last_changed_at = now()
      where id = p_action.target_id;
    when 'set_epistemic_status' then
      update public.units set epistemic_status = (v_state ->> 'epistemicStatus')::public.epistemic_status, last_changed_at = now()
      where id = p_action.target_id;
    when 'link' then
      update public.relationships set retired_at = now() where id = (v_state ->> 'relationshipId')::uuid;
    when 'merge_duplicates' then
      update public.units set retired_at = null, last_changed_at = now()
      where id = any (change_control.uuid_array(v_state -> 'retiredUnitIds'));
    else
      perform change_control.undo_create(p_action);
  end case;
  update public.actions set outcome = 'reverted', reverted_by_event_id = p_revert_event_id where id = p_action.id;
end $$;


-- =====================================================================
-- PUBLIC: REVERT A CHANGESET (Undo on the Changes screen)
-- Opens a 'revert' event, undoes applied actions newest first, drops the
-- set's open exceptions. Returns { eventId } (the revert event, whose
-- touched units the living page rebuilds).
-- =====================================================================

create function public.revert_change_set(p_change_set_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set public.change_sets;
  v_event_id uuid;
  v_action public.actions;
begin
  select * into v_set from public.change_sets where id = p_change_set_id for update;
  if v_set.status not in ('applied', 'partly_applied') then
    raise exception 'Only an applied change can be undone (this one is %).', coalesce(v_set.status::text, 'missing');
  end if;
  insert into public.shift_events (cause, actor, status) values ('revert', 'person', 'checking')
  returning id into v_event_id;
  for v_action in
    select * from public.actions where change_set_id = v_set.id and outcome = 'applied' order by position desc
  loop
    perform change_control.undo_action(v_action, v_event_id);
  end loop;
  update public.exceptions set status = 'rejected', resolved_at = now(), note = 'Closed by undo'
  where status = 'open' and action_id in (select id from public.actions where change_set_id = v_set.id);
  update public.actions set outcome = 'rejected' where change_set_id = v_set.id and outcome = 'exception';
  update public.change_sets set status = 'reverted' where id = v_set.id;
  update public.shift_events set status = 'reverted' where id = v_set.event_id;
  update public.shift_events set status = 'applied', finished_at = now() where id = v_event_id;
  return jsonb_build_object('eventId', v_event_id);
end $$;


-- =====================================================================
-- PUBLIC: ANSWER AN EXCEPTION (Accept or Reject on the Exceptions screen)
-- Accept applies the held action now (the person broke the tie);
-- rejecting a domain tree review removes the AI's unused new domains.
-- Returns { eventId } of the event whose units changed, or null.
-- =====================================================================

create function public.resolve_exception(p_exception_id uuid, p_accept boolean, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exception public.exceptions;
  v_action public.actions;
  v_set public.change_sets;
begin
  select * into v_exception from public.exceptions where id = p_exception_id for update;
  if v_exception.status is distinct from 'open' then raise exception 'This exception is already answered.'; end if;
  select * into v_action from public.actions where id = v_exception.action_id for update;
  select * into v_set from public.change_sets where id = v_action.change_set_id;
  update public.exceptions
  set status = case when p_accept then 'accepted' else 'rejected' end::public.exception_status,
      resolved_at = now(), note = p_note
  where id = v_exception.id;

  if v_exception.reason = 'domain_tree_review' then
    if not p_accept then perform change_control.reject_domain_tree(v_set.id); end if;
    return jsonb_build_object('eventId', null);
  end if;
  if not p_accept then
    update public.actions set outcome = 'rejected' where id = v_action.id;
    perform change_control.refresh_status(v_set.id);
    return jsonb_build_object('eventId', null);
  end if;
  return change_control.accept_held_action(v_action, v_set);
end $$;

-- ACCEPT: apply the held action, unless its unit moved since it was drafted
create function change_control.accept_held_action(p_action public.actions, p_set public.change_sets)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  if p_action.expected_revision_id is not null and exists (
    select 1 from public.units where id = p_action.target_id and current_revision_id <> p_action.expected_revision_id
  ) then
    raise exception 'This knowledge changed since the question was asked. Reject it and upload again.';
  end if;
  perform change_control.apply_action(p_action, p_set.event_id, p_set.proposed_by);
  perform change_control.refresh_status(p_set.id);
  return jsonb_build_object('eventId', p_set.event_id);
end $$;

-- REJECT THE AI'S DOMAIN TREE: delete the new domains nothing uses yet, deepest first
create function change_control.reject_domain_tree(p_change_set_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_action public.actions;
begin
  for v_action in
    select * from public.actions
    where change_set_id = p_change_set_id and type = 'create_domain' and outcome = 'applied'
    order by position desc
  loop
    perform change_control.undo_create(v_action);
  end loop;
end $$;


-- =====================================================================
-- ACCESS: only server code (secret key = service_role) may call these
-- =====================================================================

revoke execute on all functions in schema change_control from public, anon, authenticated;
revoke execute on function public.submit_change_set(uuid, public.event_cause, public.actor_kind, text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.commit_change_set(uuid) from public, anon, authenticated;
revoke execute on function public.revert_change_set(uuid) from public, anon, authenticated;
revoke execute on function public.resolve_exception(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.submit_change_set(uuid, public.event_cause, public.actor_kind, text, jsonb, jsonb) to service_role;
grant execute on function public.commit_change_set(uuid) to service_role;
grant execute on function public.revert_change_set(uuid) to service_role;
grant execute on function public.resolve_exception(uuid, boolean, text) to service_role;
