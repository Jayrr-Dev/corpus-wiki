-- =====================================================================
-- SECOND BRAIN · LINES AS ROWS (Sam chose 2026-10-14)
-- =====================================================================
-- Every line of every wiki section is its own row with a full history,
-- the claim revisions it states, and who wrote it. Same shape as
-- units/revisions: a stable handle plus never-edited versions.
-- Spec: second-brain/specs/lines-as-rows/spec.md in the project files.
--
--   * Lines change only through typed actions in a ChangeSet
--     (write_line, revise_line, retire_line, move_line), so they get the
--     same commit, trace and undo as claims.
--   * A line cites claim revisions (unit_revision_ids). A line is stale
--     when a claim revision it cites is no longer current (stale_lines).
--   * sections.body becomes a cache of the current lines, rewritten in
--     the same transaction as any line change; sentence_links is gone.
--   * Changes flow both ways: editing a line that states one claim also
--     revises that claim in the same ChangeSet, which makes every other
--     line citing it stale, and the living page rewrites those lines.
--
-- LINE ACTION INPUTS (actions.input)
--   write_line   { sectionId, position, content, unitRevisionIds, citePositions? }
--   revise_line  { content, unitRevisionIds, citePositions?, expectedLineRevisionId }
--   retire_line  { expectedLineRevisionId }
--   move_line    { position, expectedLineRevisionId }
-- citePositions names claim revisions an earlier action of the same set
-- creates (its after_revision_id), for the two-way edit.
-- =====================================================================


-- =====================================================================
-- ENUMS: line edits are typed actions like every other change
-- =====================================================================

alter type public.action_type add value if not exists 'write_line';
alter type public.action_type add value if not exists 'revise_line';
alter type public.action_type add value if not exists 'retire_line';
alter type public.action_type add value if not exists 'move_line';


-- =====================================================================
-- LINES AND LINE REVISIONS
-- =====================================================================

-- LINES: stable handle for one line of a section
create table public.lines (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  section_id uuid not null references public.sections (id) on delete cascade,
  position integer not null,                  -- order inside the section; gaps allowed
  current_revision_id uuid not null,          -- FK added below (lines and line_revisions point at each other)
  retired_at timestamptz,                     -- null means the line is shown
  last_changed_at timestamptz not null default now()
);
comment on table public.lines is 'One line of a wiki section. What it says lives in its current revision.';
create index lines_section_idx on public.lines (section_id, position) where retired_at is null;

-- LINE REVISIONS: every version of a line, never edited
create table public.line_revisions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  line_id uuid not null references public.lines (id) on delete cascade,
  content text not null,
  replaces_revision_id uuid references public.line_revisions (id),
  unit_revision_ids uuid[] not null default '{}', -- the claims this line states; empty = "source needed"
  event_id uuid not null references public.shift_events (id),
  author public.actor_kind not null,
  model_version text                          -- trace, when an agent wrote it
);
comment on table public.line_revisions is 'One version of a line. Old versions are kept for history, diffs and undo.';
create index line_revisions_line_idx on public.line_revisions (line_id, created_at desc);
create index line_revisions_units_idx on public.line_revisions using gin (unit_revision_ids);

-- Deferred so a line and its first revision can be inserted in one transaction
alter table public.lines
  add constraint lines_current_revision_fk
  foreign key (current_revision_id) references public.line_revisions (id)
  deferrable initially deferred;

-- UNDO: actions point at the line revisions they swapped
alter table public.actions
  add column before_line_revision_id uuid references public.line_revisions (id) on delete set null,
  add column after_line_revision_id uuid references public.line_revisions (id) on delete set null;

-- SECTIONS: body becomes a cache assembled from current lines
alter table public.sections drop column sentence_links;
comment on column public.sections.body is
  'Cache of the current lines in position order, rewritten in the same transaction as any line change. Never edited directly.';


-- =====================================================================
-- VIEWS (security_invoker: the reader's RLS applies)
-- =====================================================================

-- STALE LINES: declared, not stored. A line is stale when a claim it
-- states has a newer current revision (or was retired).
create view public.stale_lines with (security_invoker = true) as
select distinct l.id as line_id, l.section_id, lr.id as line_revision_id, lr.author
from public.lines l
join public.line_revisions lr on lr.id = l.current_revision_id
cross join lateral unnest(lr.unit_revision_ids) as cited(revision_id)
join public.revisions r on r.id = cited.revision_id
join public.units u on u.id = r.unit_id
where l.retired_at is null
  and (u.current_revision_id <> r.id or u.retired_at is not null);

-- SECTION LINES: what the wiki page reads, one row per shown line with its current text
create view public.section_lines with (security_invoker = true) as
select l.id as line_id, l.section_id, s.page_id, l.position, lr.id as line_revision_id, lr.content,
       lr.unit_revision_ids, lr.author, lr.model_version, l.last_changed_at,
       exists (select 1 from public.stale_lines sl where sl.line_id = l.id) as is_stale
from public.lines l
join public.line_revisions lr on lr.id = l.current_revision_id
join public.sections s on s.id = l.section_id
where l.retired_at is null;


-- =====================================================================
-- ACCESS AND REALTIME: same rules as the other tables
-- =====================================================================

do $$
declare
  t text;
begin
  foreach t in array array['lines', 'line_revisions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
  end loop;
  revoke all on public.stale_lines, public.section_lines from anon, authenticated;
  grant select on public.stale_lines, public.section_lines to authenticated;

  -- LIVE PAGE: open screens hear about each changed line
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.lines;
  end if;
end $$;


-- =====================================================================
-- CHANGE CONTROL: line checks and writers
-- =====================================================================

-- BODY CACHE AND INPUTS: rebuilt from the section's current lines after any line change
create function change_control.refresh_section_cache(p_section_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.sections
  set body = coalesce((
    select string_agg(lr.content, ' ' order by l.position, l.created_at)
    from public.lines l join public.line_revisions lr on lr.id = l.current_revision_id
    where l.section_id = p_section_id and l.retired_at is null), '')
  where id = p_section_id;
  -- section_inputs = the union of the lines' citations (kept for the living page's lookups)
  delete from public.section_inputs where section_id = p_section_id;
  insert into public.section_inputs (section_id, unit_id, revision_id)
  select distinct on (r.unit_id) p_section_id, r.unit_id, r.id
  from public.lines l
  join public.line_revisions lr on lr.id = l.current_revision_id
  join public.revisions r on r.id = any (lr.unit_revision_ids)
  where l.section_id = p_section_id and l.retired_at is null
  order by r.unit_id, r.created_at desc;
end $$;

-- THE CLAIM REVISIONS A LINE ACTION CITES: listed ids plus those earlier actions of the set created
create function change_control.line_citations(p_action public.actions)
returns uuid[]
language sql stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct id), '{}') from (
    select unnest(change_control.uuid_array(p_action.input -> 'unitRevisionIds')) as id
    union all
    select a.after_revision_id from public.actions a
    where a.change_set_id = p_action.change_set_id and a.outcome = 'applied'
      and a.position in (select (jsonb_array_elements_text(coalesce(p_action.input -> 'citePositions', '[]')))::integer)
  ) cited where id is not null
$$;

-- LINE TARGET: exists, shown, and still at the revision the drafter saw
create function change_control.check_line(p_action public.actions)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_line public.lines;
begin
  if p_action.type::text not in ('revise_line', 'retire_line', 'move_line', 'write_line') then
    return null;
  end if;
  if p_action.type::text = 'write_line' then
    return change_control.check('line', exists (select 1 from public.sections where id = (p_action.input ->> 'sectionId')::uuid),
      'The section does not exist.');
  end if;
  select * into v_line from public.lines where id = p_action.target_id;
  if v_line.id is null or v_line.retired_at is not null then
    return change_control.check('line', false, 'The line does not exist or was removed.');
  end if;
  if p_action.input ? 'expectedLineRevisionId'
     and v_line.current_revision_id <> (p_action.input ->> 'expectedLineRevisionId')::uuid then
    return change_control.check('line', false, 'The line changed since this was drafted.');
  end if;
  return change_control.check('line', true, null);
end $$;

-- WRITE LINE: a new line and its first revision
create function change_control.apply_write_line(p_action public.actions, p_event_id uuid, p_author public.actor_kind, p_model text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_line_id uuid := gen_random_uuid();
  v_revision_id uuid := gen_random_uuid();
  v_section_id uuid := (p_action.input ->> 'sectionId')::uuid;
begin
  insert into public.lines (id, section_id, position, current_revision_id)
  values (v_line_id, v_section_id, coalesce((p_action.input ->> 'position')::integer, 0), v_revision_id);
  insert into public.line_revisions (id, line_id, content, unit_revision_ids, event_id, author, model_version)
  values (v_revision_id, v_line_id, p_action.input ->> 'content', change_control.line_citations(p_action), p_event_id, p_author, p_model);
  update public.actions set target_id = v_line_id, after_line_revision_id = v_revision_id, undo_state = '{}'
  where id = p_action.id;
  perform change_control.refresh_section_cache(v_section_id);
end $$;

-- REVISE LINE: a new revision replaces the current one (the old one is kept)
create function change_control.apply_revise_line(p_action public.actions, p_event_id uuid, p_author public.actor_kind, p_model text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_line public.lines;
  v_revision_id uuid;
begin
  select * into v_line from public.lines where id = p_action.target_id for update;
  insert into public.line_revisions (line_id, content, replaces_revision_id, unit_revision_ids, event_id, author, model_version)
  values (v_line.id, p_action.input ->> 'content', v_line.current_revision_id, change_control.line_citations(p_action),
          p_event_id, p_author, p_model)
  returning id into v_revision_id;
  update public.lines set current_revision_id = v_revision_id, last_changed_at = now() where id = v_line.id;
  update public.actions set before_line_revision_id = v_line.current_revision_id, after_line_revision_id = v_revision_id
  where id = p_action.id;
  perform change_control.refresh_section_cache(v_line.section_id);
end $$;

-- RETIRE LINE: leaves the page, stays in history
create function change_control.apply_retire_line(p_action public.actions)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_line public.lines;
begin
  select * into v_line from public.lines where id = p_action.target_id for update;
  update public.lines set retired_at = now(), last_changed_at = now() where id = v_line.id;
  update public.actions set before_line_revision_id = v_line.current_revision_id where id = p_action.id;
  perform change_control.refresh_section_cache(v_line.section_id);
end $$;

-- MOVE LINE: a new position inside its section
create function change_control.apply_move_line(p_action public.actions)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_line public.lines;
begin
  select * into v_line from public.lines where id = p_action.target_id for update;
  update public.lines set position = (p_action.input ->> 'position')::integer, last_changed_at = now() where id = v_line.id;
  update public.actions set undo_state = jsonb_build_object('position', v_line.position) where id = p_action.id;
  perform change_control.refresh_section_cache(v_line.section_id);
end $$;


-- =====================================================================
-- CHANGE CONTROL: the shared functions, now aware of line actions
-- =====================================================================

-- ALL CHECKS FOR ONE ACTION, folded into one verdict (adds the line check)
create or replace function change_control.judge(p_action public.actions, p_proposed_by public.actor_kind)
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
    change_control.check_line(p_action),
    change_control.check_references(p_action),
    change_control.check_source_date(p_action, p_proposed_by),
    change_control.check_decision(p_action),
    change_control.check_deletion(p_action, p_proposed_by)
  ] loop
    continue when v_check is null;
    v_checks := v_checks || v_check;
    continue when (v_check ->> 'passed')::boolean or v_outcome = 'rejected';
    v_detail := v_check ->> 'detail';
    -- A failed target, line, reference or date check rejects; the rest ask a person
    case v_check ->> 'name'
      when 'source_tie' then v_outcome := 'exception'; v_reason := 'source_tie';
      when 'decision' then v_outcome := 'exception'; v_reason := 'decision_conflict';
      when 'deletion' then v_outcome := 'exception'; v_reason := 'deletion';
      else v_outcome := 'rejected'; v_reason := null;
    end case;
  end loop;
  return jsonb_build_object('outcome', v_outcome, 'reason', v_reason, 'detail', v_detail, 'checks', v_checks);
end $$;

-- APPLY ONE ACTION (already judged) and mark it applied; lines carry the set's model version
create or replace function change_control.apply_action(p_action public.actions, p_event_id uuid, p_author public.actor_kind)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_model text := (select model_version from public.change_sets where id = p_action.change_set_id);
begin
  case p_action.type::text
    when 'create_domain' then perform change_control.apply_create_domain(p_action, p_author);
    when 'create_entity' then perform change_control.apply_create_entity(p_action);
    when 'add_claim' then perform change_control.apply_add_claim(p_action, p_event_id, p_author);
    when 'revise_claim' then perform change_control.apply_revise_claim(p_action, p_event_id, p_author);
    when 'retire_claim' then perform change_control.apply_retire_claim(p_action);
    when 'set_epistemic_status' then perform change_control.apply_set_epistemic_status(p_action);
    when 'link' then perform change_control.apply_link(p_action, p_event_id);
    when 'merge_duplicates' then perform change_control.apply_merge_duplicates(p_action);
    when 'write_line' then perform change_control.apply_write_line(p_action, p_event_id, p_author, v_model);
    when 'revise_line' then perform change_control.apply_revise_line(p_action, p_event_id, p_author, v_model);
    when 'retire_line' then perform change_control.apply_retire_line(p_action);
    when 'move_line' then perform change_control.apply_move_line(p_action);
  end case;
  update public.actions set outcome = 'applied', applied_at = now() where id = p_action.id;
end $$;

-- A later change touched this action's unit or line? (undo would lose it)
create or replace function change_control.unit_moved_since(p_action public.actions)
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1 from public.actions later
    where later.target_id = p_action.target_id and later.outcome = 'applied'
      and later.applied_at > p_action.applied_at and later.id <> p_action.id
      and p_action.type::text in ('add_claim', 'revise_claim', 'retire_claim', 'set_epistemic_status',
                                  'write_line', 'revise_line', 'retire_line', 'move_line')
  )
$$;

-- THE INVERSE OF ONE APPLIED LINE ACTION
create function change_control.undo_line_action(p_action public.actions)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_section_id uuid := (select section_id from public.lines where id = p_action.target_id);
begin
  case p_action.type::text
    when 'write_line' then
      update public.lines set retired_at = now(), last_changed_at = now() where id = p_action.target_id;
    when 'revise_line' then
      update public.lines set current_revision_id = p_action.before_line_revision_id, last_changed_at = now()
      where id = p_action.target_id;
    when 'retire_line' then
      update public.lines set retired_at = null, last_changed_at = now() where id = p_action.target_id;
    when 'move_line' then
      update public.lines set position = (p_action.undo_state ->> 'position')::integer, last_changed_at = now()
      where id = p_action.target_id;
  end case;
  perform change_control.refresh_section_cache(v_section_id);
end $$;

-- THE INVERSE OF ONE APPLIED ACTION (line actions handled above)
create or replace function change_control.undo_action(p_action public.actions, p_revert_event_id uuid)
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
  case
    when p_action.type::text in ('write_line', 'revise_line', 'retire_line', 'move_line') then
      perform change_control.undo_line_action(p_action);
    when p_action.type = 'add_claim' then
      update public.units set retired_at = now(), last_changed_at = now() where id = p_action.target_id;
    when p_action.type = 'revise_claim' then
      update public.units set current_revision_id = p_action.before_revision_id,
        epistemic_status = (v_state ->> 'epistemicStatus')::public.epistemic_status,
        valid_from = (v_state ->> 'validFrom')::timestamptz, last_changed_at = now()
      where id = p_action.target_id;
    when p_action.type = 'retire_claim' then
      update public.units set retired_at = null, valid_to = (v_state ->> 'validTo')::timestamptz, last_changed_at = now()
      where id = p_action.target_id;
    when p_action.type = 'set_epistemic_status' then
      update public.units set epistemic_status = (v_state ->> 'epistemicStatus')::public.epistemic_status, last_changed_at = now()
      where id = p_action.target_id;
    when p_action.type = 'link' then
      update public.relationships set retired_at = now() where id = (v_state ->> 'relationshipId')::uuid;
    when p_action.type = 'merge_duplicates' then
      update public.units set retired_at = null, last_changed_at = now()
      where id = any (change_control.uuid_array(v_state -> 'retiredUnitIds'));
    else
      perform change_control.undo_create(p_action);
  end case;
  update public.actions set outcome = 'reverted', reverted_by_event_id = p_revert_event_id where id = p_action.id;
end $$;

-- STATUS: an event's status mirrors its FIRST ChangeSet (the claims); the living
-- page's later line ChangeSets for the same event never overwrite it
create or replace function change_control.refresh_status(p_change_set_id uuid)
returns public.change_set_status
language plpgsql
set search_path = ''
as $$
declare
  v_total integer;
  v_applied integer;
  v_held integer;
  v_status public.change_set_status;
  v_event_id uuid := (select event_id from public.change_sets where id = p_change_set_id);
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
  if p_change_set_id = (select id from public.change_sets where event_id = v_event_id order by created_at, id limit 1) then
    -- The event finished either way; a rejected set (e.g. an older file) simply changed nothing
    update public.shift_events
    set status = case when v_status = 'partly_applied' then 'partly_applied' else 'applied' end::public.event_status,
        finished_at = now()
    where id = v_event_id and status <> 'reverted';
  end if;
  return v_status;
end $$;

-- SUBMIT: unchanged, except a later ChangeSet for an event leaves the event's status alone
create or replace function public.submit_change_set(
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
  elsif not exists (select 1 from public.change_sets where event_id = v_event_id) then
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
-- LIVING PAGE: read a section's lines, and finish a rebuild
-- (the lines themselves are written by commit_change_set)
-- =====================================================================

-- AFFECTED SECTIONS: generated sections with stale lines, or whose query selects a
-- unit the event touched. Returns [{ sectionId, pageId }]
create or replace function public.list_affected_sections(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with touched as (
    select touched_id from public.living_page_event_units(p_event_id) as t(touched_id)
  )
  select coalesce(
    jsonb_agg(jsonb_build_object('sectionId', s.id, 'pageId', s.page_id) order by s.page_id, s.position),
    '[]'::jsonb
  )
  from public.sections s
  where s.mode = 'generated'
    and (
      exists (select 1 from public.stale_lines sl where sl.section_id = s.id)
      or exists (
        select 1 from public.section_inputs si
        where si.section_id = s.id and si.unit_id in (select touched_id from touched)
      )
      or exists (
        select 1 from public.living_page_query_units(s.query) as q(unit_id)
        where q.unit_id in (select touched_id from touched)
      )
    );
$$;

-- SECTION STATE: the units the query selects now and the current lines, each line
-- flagged when it must be rewritten (stale, or citing a unit the section no longer shows).
-- Returns { sectionId, title, pageTitle, units: [...], lines: [{ lineId, lineRevisionId,
-- position, content, author, unitIds, needsRewrite }] }
create function public.read_section_state(p_section_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state jsonb := public.read_section_units(p_section_id);
  v_selected uuid[] := array(select public.living_page_query_units(
    (select query from public.sections where id = p_section_id)));
begin
  return v_state || jsonb_build_object('lines', coalesce((
    select jsonb_agg(jsonb_build_object(
      'lineId', l.id, 'lineRevisionId', lr.id, 'position', l.position, 'content', lr.content,
      'author', lr.author,
      'unitIds', coalesce((select jsonb_agg(distinct r.unit_id) from public.revisions r where r.id = any (lr.unit_revision_ids)), '[]'),
      'needsRewrite', exists (select 1 from public.stale_lines sl where sl.line_id = l.id)
        or exists (select 1 from public.revisions r where r.id = any (lr.unit_revision_ids) and r.unit_id <> all (v_selected))
    ) order by l.position, l.created_at)
    from public.lines l join public.line_revisions lr on lr.id = l.current_revision_id
    where l.section_id = p_section_id and l.retired_at is null), '[]'));
end $$;

-- FINISH A BUILD: status current, the model that wrote it, and a change note when an event caused it.
-- Returns { sectionId, changeNoteId }
create function public.finish_section_build(p_section_id uuid, p_event_id uuid, p_model_version text, p_changed boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note_id uuid;
begin
  update public.sections
  set status = 'current', built_at = now(), built_with_model_version = coalesce(p_model_version, built_with_model_version)
  where id = p_section_id;
  if not found then raise exception 'Section % does not exist.', p_section_id; end if;
  if p_event_id is not null and p_changed then
    insert into public.change_notes (section_id, event_id, summary)
    values (p_section_id, p_event_id, public.living_page_change_summary(p_event_id,
      array(select unit_id from public.section_inputs where section_id = p_section_id
            union select public.living_page_event_units(p_event_id))))
    returning id into v_note_id;
  end if;
  return jsonb_build_object('sectionId', p_section_id, 'changeNoteId', v_note_id);
end $$;

-- A FAILED BUILD: the section goes back to stale (never left 'building')
create function public.mark_section_stale(p_section_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  update public.sections set status = 'stale' where id = p_section_id
  returning jsonb_build_object('sectionId', id, 'status', status);
$$;

-- ONE LINE AND THE CLAIMS IT STATES (for a person's line edit).
-- Returns { lineId, lineRevisionId, sectionId, content, claims: [{ unitId, citedRevisionId, currentRevisionId }] }
create function public.read_line(p_line_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'lineId', l.id, 'lineRevisionId', lr.id, 'sectionId', l.section_id, 'content', lr.content,
    'claims', coalesce((
      select jsonb_agg(jsonb_build_object('unitId', u.id, 'citedRevisionId', r.id, 'currentRevisionId', u.current_revision_id))
      from public.revisions r join public.units u on u.id = r.unit_id
      where r.id = any (lr.unit_revision_ids) and u.retired_at is null), '[]'))
  from public.lines l join public.line_revisions lr on lr.id = l.current_revision_id
  where l.id = p_line_id and l.retired_at is null
$$;

-- The build no longer saves prose directly: lines go through Change control
drop function public.save_section_build(uuid, uuid, jsonb);


-- =====================================================================
-- ACCESS: only server code (secret key = service_role) may call these
-- =====================================================================

revoke execute on all functions in schema change_control from public, anon, authenticated;
revoke execute on function public.read_section_state(uuid) from public, anon, authenticated;
revoke execute on function public.finish_section_build(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke execute on function public.mark_section_stale(uuid) from public, anon, authenticated;
revoke execute on function public.read_line(uuid) from public, anon, authenticated;
grant execute on function public.read_section_state(uuid) to service_role;
grant execute on function public.finish_section_build(uuid, uuid, text, boolean) to service_role;
grant execute on function public.mark_section_stale(uuid) to service_role;
grant execute on function public.read_line(uuid) to service_role;
