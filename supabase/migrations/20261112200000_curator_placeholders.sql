-- =====================================================================
-- CURATOR PLACEHOLDER PAGES: the Curator may create a new parent page and
-- file existing pages under it, to build the tree's hierarchy (a page left
-- at the top level whose subject belongs to a broader topic).
--
--   update_page { operation: 'group', title, articleType, scope, parentPageId (null = top level), pageIds, ... }
-- target = the first page filed under it. One action: the new page and every
-- move apply and undo together. A group always waits in Exceptions.
-- The new page starts empty; the Planner writes its overview once it holds pages.
-- =====================================================================

-- CHECK: a title, live pages to file, and a parent that is not one of them (or under them)
alter function change_control.check_page(public.actions, public.actor_kind) rename to check_page_before_group;
create function change_control.check_page(p_action public.actions, p_proposed_by public.actor_kind)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_parent uuid := (p_action.input ->> 'parentPageId')::uuid;
begin
  if p_action.type::text <> 'update_page' or p_action.input ->> 'operation' is distinct from 'group' then
    return change_control.check_page_before_group(p_action, p_proposed_by);
  end if;
  v_ids := change_control.uuid_array(coalesce(p_action.input -> 'pageIds', '[]'));
  if trim(coalesce(p_action.input ->> 'title', '')) = '' then
    return change_control.check('page', false, 'A new page needs a title.');
  end if;
  if coalesce(p_action.input ->> 'articleType', '') not in ('entity', 'process', 'requirement', 'concept') then
    return change_control.check('page', false, 'Unknown article type.');
  end if;
  if coalesce(array_length(v_ids, 1), 0) = 0
     or (select count(*) from public.pages where id = any (v_ids) and retired_at is null) <> array_length(v_ids, 1) then
    return change_control.check('page', false, 'A page to file under the new page does not exist or was removed.');
  end if;
  if v_parent is not null and (not exists (select 1 from public.pages where id = v_parent and retired_at is null)
     or exists (select 1 from unnest(v_ids) moved where change_control.page_within(v_parent, moved))) then
    return change_control.check('page', false, 'The new page cannot sit under a page it would hold.');
  end if;
  return change_control.check('page', true, null);
end $$;

-- JUDGE: a new parent page reshapes the tree, so a person always decides
alter function change_control.judge(public.actions, public.actor_kind) rename to judge_before_group;
create function change_control.judge(p_action public.actions, p_proposed_by public.actor_kind)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_result jsonb := change_control.judge_before_group(p_action, p_proposed_by);
begin
  if p_action.type::text = 'update_page' and p_action.input ->> 'operation' = 'group'
     and p_proposed_by = 'ai' and v_result ->> 'outcome' = 'applied' then
    return jsonb_build_object('outcome', 'exception', 'reason', 'page_structure_review',
      'detail', p_action.input ->> 'reason', 'checks', v_result -> 'checks');
  end if;
  return v_result;
end $$;

-- APPLY: the new page, then each page moves under it
alter function change_control.apply_update_page(public.actions) rename to apply_update_page_before_group;
create function change_control.apply_update_page(p_action public.actions)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_title text := trim(p_action.input ->> 'title');
  v_page_id uuid;
  v_moved jsonb := '[]';
  v_page public.pages;
begin
  if p_action.input ->> 'operation' is distinct from 'group' then
    perform change_control.apply_update_page_before_group(p_action);
    return;
  end if;
  insert into public.pages (title, slug, article_type, scope, parent_page_id)
  values (v_title, change_control.unique_page_slug(v_title), p_action.input ->> 'articleType',
          nullif(trim(coalesce(p_action.input ->> 'scope', '')), ''), (p_action.input ->> 'parentPageId')::uuid)
  returning id into v_page_id;
  for v_page in select * from public.pages
    where id = any (change_control.uuid_array(p_action.input -> 'pageIds')) and retired_at is null for update loop
    v_moved := v_moved || jsonb_build_array(jsonb_build_object('id', v_page.id, 'parentPageId', v_page.parent_page_id));
    update public.pages set parent_page_id = v_page_id where id = v_page.id;
  end loop;
  update public.actions set undo_state = jsonb_build_object('createdPageId', v_page_id, 'moved', v_moved) where id = p_action.id;
end $$;

-- UNDO: the pages go back, the new page is removed (refused while later changes build on it)
alter function change_control.undo_update_page(public.actions) rename to undo_update_page_before_group;
create function change_control.undo_update_page(p_action public.actions)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_created uuid := (p_action.undo_state ->> 'createdPageId')::uuid;
  v_moved jsonb;
begin
  if p_action.input ->> 'operation' is distinct from 'group' then
    perform change_control.undo_update_page_before_group(p_action);
    return;
  end if;
  if exists (
    select 1 from public.actions later
    where later.outcome = 'applied' and later.applied_at > p_action.applied_at and later.id <> p_action.id
      and (later.target_id = v_created or later.input ->> 'pageId' = v_created::text
           or later.input ->> 'intoPageId' = v_created::text or later.input ->> 'parentPageId' = v_created::text)
  ) then
    raise exception 'A later change built on the new page. Undo that change first.';
  end if;
  for v_moved in select value from jsonb_array_elements(coalesce(p_action.undo_state -> 'moved', '[]')) loop
    update public.pages set parent_page_id = (v_moved ->> 'parentPageId')::uuid where id = (v_moved ->> 'id')::uuid;
  end loop;
  update public.pages set retired_at = now() where id = v_created;
end $$;

revoke execute on all functions in schema change_control from public, anon, authenticated;
