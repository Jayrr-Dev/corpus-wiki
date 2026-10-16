-- =====================================================================
-- CURATOR: the AI role that keeps the wiki's page structure clean, like a
-- librarian. It merges pages that repeat each other, moves pages under the
-- right parent, renames unclear titles and sets each page's type and scope.
-- It never edits the text inside a page.
--
-- Every Curator proposal is ONE update_page action, so a merge (new section on
-- the page that stays, child pages moved, the merged page retired) applies and
-- undoes as a unit. Merges and moves always wait on Exceptions; a confident
-- rename or type is applied at once (undoable in Changes).
--
--   update_page { operation: 'merge', intoPageId, sectionTitle, unitIds, curator, confident, reason }
--   update_page { operation: 'move', parentPageId (null = top level), ... }
--   update_page { operation: 'rename', title, ... }
--   update_page { operation: 'set_type', articleType, scope, ... }
-- target = the page acted on (for a merge, the page that goes away).
-- =====================================================================

alter type public.action_type add value if not exists 'update_page';
alter type public.exception_reason add value if not exists 'page_structure_review';


-- =====================================================================
-- 1. THE ROLE: allowed wherever roles are named
-- =====================================================================

alter table public.ai_role_instructions drop constraint ai_role_instructions_role_check;
alter table public.ai_role_instructions add constraint ai_role_instructions_role_check check
  (role in ('extract_knowledge','identify_entities','link_knowledge','organize_topics','define_concepts','plan_articles','write_articles','researcher','reviewer','domain_steward','article_reviewer','curator'));

alter table public.ai_role_memory drop constraint ai_role_memory_role_check;
alter table public.ai_role_memory add constraint ai_role_memory_role_check check
  (role in ('media_analyst','reconciler','deduplicator','identify_entities','link_knowledge','dictionary_editor','define_concepts','plan_articles','article_reviewer','write_articles','reviewer','researcher','domain_steward','curator'));

create or replace function public.set_ai_role_model(p_role text, p_model text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_model text := nullif(btrim(p_model), '');
begin
  if p_role is null or p_role not in ('media_analyst','reconciler','deduplicator','identify_entities','link_knowledge','dictionary_editor','define_concepts','plan_articles','article_reviewer','write_articles','reviewer','researcher','domain_steward','curator') then
    raise exception 'Unknown AI role: %', p_role;
  end if;
  insert into public.workspace_settings (id, ai_role_models, updated_at)
  values (true, case when v_model is null then '{}'::jsonb else jsonb_build_object(p_role, v_model) end, now())
  on conflict (id) do update set
    ai_role_models = case when v_model is null then public.workspace_settings.ai_role_models - p_role
                          else public.workspace_settings.ai_role_models || jsonb_build_object(p_role, v_model) end,
    updated_at = excluded.updated_at;
  return public.get_workspace_settings();
end;
$$;

create or replace function public.set_ai_role_effort(p_role text, p_effort text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_effort text := nullif(btrim(p_effort), '');
begin
  if p_role is null or p_role not in ('media_analyst','reconciler','deduplicator','identify_entities','link_knowledge','dictionary_editor','define_concepts','plan_articles','article_reviewer','write_articles','reviewer','researcher','domain_steward','curator') then
    raise exception 'Unknown AI role: %', p_role;
  end if;
  if v_effort is not null and v_effort not in ('low', 'medium', 'high') then
    raise exception 'Unknown reasoning effort: %', p_effort;
  end if;
  insert into public.workspace_settings (id, ai_role_efforts, updated_at)
  values (true, case when v_effort is null then '{}'::jsonb else jsonb_build_object(p_role, v_effort) end, now())
  on conflict (id) do update set
    ai_role_efforts = case when v_effort is null then public.workspace_settings.ai_role_efforts - p_role
                           else public.workspace_settings.ai_role_efforts || jsonb_build_object(p_role, v_effort) end,
    updated_at = excluded.updated_at;
  return public.get_workspace_settings();
end;
$$;


-- THE CURATOR'S STARTING MODEL: Claude Opus 5.5 at high effort (a person can change both in Settings)
insert into public.workspace_settings (id, ai_role_models, ai_role_efforts, updated_at)
values (true, '{"curator": "anthropic/claude-opus-5-5"}', '{"curator": "high"}', now())
on conflict (id) do update set
  ai_role_models = case when public.workspace_settings.ai_role_models ? 'curator' then public.workspace_settings.ai_role_models
                        else public.workspace_settings.ai_role_models || '{"curator": "anthropic/claude-opus-5-5"}' end,
  ai_role_efforts = case when public.workspace_settings.ai_role_efforts ? 'curator' then public.workspace_settings.ai_role_efforts
                         else public.workspace_settings.ai_role_efforts || '{"curator": "high"}' end;


-- =====================================================================
-- 2. WHAT THE CURATOR READS: every live page, the claims its lines cite,
-- and the claims' vectors (one read, so nothing is cut off at a row cap)
-- =====================================================================

create function public.curator_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with page_claims as (
    select distinct s.page_id, r.unit_id
    from public.sections s
    join public.lines l on l.section_id = s.id and l.retired_at is null
    join public.line_revisions lr on lr.id = l.current_revision_id
    cross join lateral unnest(lr.unit_revision_ids) as cited(revision_id)
    join public.revisions r on r.id = cited.revision_id
    join public.units u on u.id = r.unit_id and u.retired_at is null
    where s.retired_at is null
  ),
  live_pages as (select * from public.pages where retired_at is null),
  claim_ids as (select distinct unit_id from page_claims)
  select jsonb_build_object(
    'pages', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'title', p.title, 'parentId', p.parent_page_id,
      'articleType', p.article_type, 'scope', p.scope,
      'contextName', coalesce(ce.name, case when e.type in ('company','organization','project','person','team','product') then e.name end),
      'claimIds', coalesce((select jsonb_agg(pc.unit_id order by pc.unit_id) from page_claims pc where pc.page_id = p.id), '[]'),
      'lines', (select count(*) from public.sections s join public.lines l on l.section_id = s.id and l.retired_at is null
                where s.page_id = p.id and s.retired_at is null),
      'sections', coalesce((select jsonb_agg(s.title order by s.position) from public.sections s
                            where s.page_id = p.id and s.retired_at is null), '[]')
    ) order by p.title, p.id)
    from live_pages p
    left join public.entities e on e.id = p.entity_id
    left join public.entities ce on ce.id = p.context_entity_id), '[]'),
    'claims', coalesce((select jsonb_agg(jsonb_build_object(
      'id', u.id, 'title', coalesce(nullif(btrim(r.title), ''), left(r.content, 160))
    ) order by u.id)
    from claim_ids c join public.units u on u.id = c.unit_id join public.revisions r on r.id = u.current_revision_id), '[]'),
    'vectors', coalesce((select jsonb_agg(jsonb_build_object('id', v.unit_id, 'vector', v.embedding::text))
    from (select distinct on (ue.unit_id) ue.unit_id, ue.embedding
          from public.unit_embeddings ue join claim_ids c on c.unit_id = ue.unit_id
          join public.units u on u.id = ue.unit_id
          order by ue.unit_id, (ue.revision_id = u.current_revision_id) desc, ue.created_at desc) v), '[]')
  )
$$;

revoke all on function public.curator_snapshot() from public, anon, authenticated;
grant execute on function public.curator_snapshot() to service_role;


-- =====================================================================
-- 3. CHECK: the page (and any page it names) is live, and a move or merge
-- never puts a page under itself
-- =====================================================================

-- True when p_page_id is p_root or sits anywhere under it
create function change_control.page_within(p_page_id uuid, p_root uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  with recursive up as (
    select id, parent_page_id, 1 as depth from public.pages where id = p_page_id
    union all
    select p.id, p.parent_page_id, up.depth + 1 from public.pages p join up on p.id = up.parent_page_id where up.depth < 100
  )
  select exists (select 1 from up where id = p_root)
$$;

alter function change_control.check_page(public.actions, public.actor_kind) rename to check_page_before_curator;
create function change_control.check_page(p_action public.actions, p_proposed_by public.actor_kind)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_operation text := p_action.input ->> 'operation';
  v_into uuid := (p_action.input ->> 'intoPageId')::uuid;
  v_parent uuid := (p_action.input ->> 'parentPageId')::uuid;
begin
  if p_action.type::text <> 'update_page' then
    return change_control.check_page_before_curator(p_action, p_proposed_by);
  end if;
  if not exists (select 1 from public.pages where id = p_action.target_id and retired_at is null) then
    return change_control.check('page', false, 'The page does not exist or was removed.');
  end if;
  case v_operation
    when 'merge' then
      if v_into is null or v_into = p_action.target_id
         or not exists (select 1 from public.pages where id = v_into and retired_at is null) then
        return change_control.check('page', false, 'The page to merge into does not exist or was removed.');
      end if;
    when 'move' then
      if v_parent is not null and (not exists (select 1 from public.pages where id = v_parent and retired_at is null)
         or change_control.page_within(v_parent, p_action.target_id)) then
        return change_control.check('page', false, 'A page cannot move under itself or under a removed page.');
      end if;
    when 'rename' then
      if trim(coalesce(p_action.input ->> 'title', '')) = '' then
        return change_control.check('page', false, 'A title cannot be empty.');
      end if;
    when 'set_type' then
      if coalesce(p_action.input ->> 'articleType', '') not in ('entity', 'process', 'requirement', 'concept') then
        return change_control.check('page', false, 'Unknown article type.');
      end if;
    else
      return change_control.check('page', false, 'Unknown page operation.');
  end case;
  return change_control.check('page', true, null);
end $$;


-- =====================================================================
-- 4. JUDGE: merges and moves wait for a person; so does anything the
-- Curator is unsure of
-- =====================================================================

alter function change_control.judge(public.actions, public.actor_kind) rename to judge_before_curator;
create function change_control.judge(p_action public.actions, p_proposed_by public.actor_kind)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_result jsonb := change_control.judge_before_curator(p_action, p_proposed_by);
begin
  if p_action.type::text <> 'update_page' or p_proposed_by <> 'ai' or v_result ->> 'outcome' <> 'applied' then
    return v_result;
  end if;
  if p_action.input ->> 'operation' in ('merge', 'move') or p_action.input ->> 'confident' is distinct from 'true' then
    return jsonb_build_object('outcome', 'exception', 'reason', 'page_structure_review',
      'detail', p_action.input ->> 'reason', 'checks', v_result -> 'checks');
  end if;
  return v_result;
end $$;


-- =====================================================================
-- 5. APPLY AND UNDO. undo_state keeps exactly what the action changed.
-- =====================================================================

create function change_control.apply_update_page(p_action public.actions)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_page public.pages;
  v_into public.pages;
  v_section_id uuid;
  v_moved jsonb := '[]';
  v_unit_ids jsonb := coalesce(p_action.input -> 'unitIds', '[]');
  v_child public.pages;
begin
  select * into v_page from public.pages where id = p_action.target_id and retired_at is null for update;
  if v_page.id is null then raise exception 'The page does not exist or was removed.'; end if;
  case p_action.input ->> 'operation'
    when 'merge' then
      select * into v_into from public.pages where id = (p_action.input ->> 'intoPageId')::uuid and retired_at is null for update;
      if v_into.id is null or v_into.id = v_page.id then raise exception 'The page to merge into does not exist or was removed.'; end if;
      -- The claims the page that stays does not state yet become one new section on it
      if jsonb_array_length(v_unit_ids) > 0 then
        v_section_id := change_control.insert_section(v_into.id,
          coalesce(nullif(trim(p_action.input ->> 'sectionTitle'), ''), v_page.title),
          jsonb_build_object('unitIds', v_unit_ids));
      end if;
      -- The page that stays leaves the merged page's subtree first, so nothing hangs under a removed page
      if change_control.page_within(v_into.id, v_page.id) then
        v_moved := v_moved || jsonb_build_array(jsonb_build_object('id', v_into.id, 'parentPageId', v_into.parent_page_id));
        update public.pages set parent_page_id = v_page.parent_page_id where id = v_into.id;
      end if;
      for v_child in select * from public.pages where parent_page_id = v_page.id and retired_at is null and id <> v_into.id loop
        v_moved := v_moved || jsonb_build_array(jsonb_build_object('id', v_child.id, 'parentPageId', v_child.parent_page_id));
        update public.pages set parent_page_id = v_into.id where id = v_child.id;
      end loop;
      update public.pages set retired_at = now() where id = v_page.id;
      update public.actions set undo_state = jsonb_build_object('sectionId', v_section_id, 'moved', v_moved) where id = p_action.id;
    when 'move' then
      update public.pages set parent_page_id = (p_action.input ->> 'parentPageId')::uuid where id = v_page.id;
      update public.actions set undo_state = jsonb_build_object('parentPageId', v_page.parent_page_id) where id = p_action.id;
    when 'rename' then
      update public.pages set title = trim(p_action.input ->> 'title') where id = v_page.id;
      update public.actions set undo_state = jsonb_build_object('title', v_page.title) where id = p_action.id;
    when 'set_type' then
      update public.pages set article_type = p_action.input ->> 'articleType',
        scope = coalesce(nullif(trim(p_action.input ->> 'scope'), ''), v_page.scope)
      where id = v_page.id;
      update public.actions set undo_state = jsonb_build_object('articleType', v_page.article_type, 'scope', v_page.scope) where id = p_action.id;
    else
      raise exception 'Unknown page operation';
  end case;
end $$;

create function change_control.undo_update_page(p_action public.actions)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_state jsonb := coalesce(p_action.undo_state, '{}');
  v_moved jsonb;
begin
  -- A later Curator change to the same page is undone first
  if exists (
    select 1 from public.actions later
    where later.type::text in ('update_page', 'rename_page', 'retire_page') and later.outcome = 'applied'
      and later.applied_at > p_action.applied_at and later.id <> p_action.id
      and (later.target_id = p_action.target_id or later.input ->> 'intoPageId' = p_action.target_id::text)
  ) then
    raise exception 'A later change edited the same page. Undo that change first.';
  end if;
  case p_action.input ->> 'operation'
    when 'merge' then
      update public.pages set retired_at = null where id = p_action.target_id;
      if v_state ->> 'sectionId' is not null then
        update public.sections set retired_at = now() where id = (v_state ->> 'sectionId')::uuid;
      end if;
      for v_moved in select value from jsonb_array_elements(coalesce(v_state -> 'moved', '[]')) loop
        update public.pages set parent_page_id = (v_moved ->> 'parentPageId')::uuid where id = (v_moved ->> 'id')::uuid;
      end loop;
    when 'move' then
      update public.pages set parent_page_id = (v_state ->> 'parentPageId')::uuid where id = p_action.target_id;
    when 'rename' then
      update public.pages set title = v_state ->> 'title' where id = p_action.target_id;
    when 'set_type' then
      update public.pages set article_type = v_state ->> 'articleType', scope = v_state ->> 'scope' where id = p_action.target_id;
  end case;
end $$;

alter function change_control.apply_action(public.actions, uuid, public.actor_kind) rename to apply_action_before_curator;
create function change_control.apply_action(p_action public.actions, p_event_id uuid, p_author public.actor_kind)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_action.type::text <> 'update_page' then
    perform change_control.apply_action_before_curator(p_action, p_event_id, p_author);
    return;
  end if;
  perform change_control.apply_update_page(p_action);
  update public.actions set outcome = 'applied', applied_at = now() where id = p_action.id;
end $$;

alter function change_control.undo_action(public.actions, uuid) rename to undo_action_before_curator;
create function change_control.undo_action(p_action public.actions, p_revert_event_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_action.type::text <> 'update_page' then
    perform change_control.undo_action_before_curator(p_action, p_revert_event_id);
    return;
  end if;
  perform change_control.undo_update_page(p_action);
  update public.actions set outcome = 'reverted', reverted_by_event_id = p_revert_event_id where id = p_action.id;
end $$;

revoke execute on all functions in schema change_control from public, anon, authenticated;
