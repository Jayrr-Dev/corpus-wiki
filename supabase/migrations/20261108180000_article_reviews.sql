-- =====================================================================
-- SECOND BRAIN · ARTICLE PROPOSALS AND REVIEWS
-- =====================================================================
-- After an upload, the Article Proposer suggests articles for its claims
-- and the independent Article Reviewer decides each one:
--   article_reviews  one row per proposal: what was proposed, the
--                    verdict (approve | update_existing | section_of |
--                    reject), why, and the page it created or updated
--   create_page      now also stores input 'articleType', 'scope' and
--                    'parentPageId' when given
--   article_index    every live article with its type, scope, parent and
--                    how many claims its lines cite: what both AIs compare
--                    a proposal against
-- =====================================================================

create table public.article_reviews (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event_id uuid references public.shift_events (id) on delete set null,
  proposal jsonb not null,
  verdict text not null check (verdict in ('approve', 'update_existing', 'section_of', 'reject')),
  failed_checks text[] not null default '{}',
  reason text not null,
  decided_by text not null check (decided_by in ('rule', 'model')),
  target_page_id uuid references public.pages (id) on delete set null,
  section_title text,
  result_page_id uuid references public.pages (id) on delete set null,
  change_set_id uuid references public.change_sets (id) on delete set null,
  model text,
  prompt_version text not null,
  tokens_in integer,
  tokens_out integer
);
create index article_reviews_event_idx on public.article_reviews (event_id);

alter table public.article_reviews enable row level security;
revoke all on public.article_reviews from anon, authenticated;
grant select, insert, update on public.article_reviews to service_role;

-- CREATE PAGE: title, slug and entity as before, plus the article's type, scope and parent
create or replace function change_control.apply_create_page(p_action public.actions)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_title text := trim(p_action.input ->> 'title');
  v_page_id uuid;
  v_section jsonb;
begin
  insert into public.pages (title, slug, entity_id, article_type, scope, parent_page_id)
  values (v_title, change_control.unique_page_slug(v_title), (p_action.input ->> 'entityId')::uuid,
          nullif(p_action.input ->> 'articleType', ''), nullif(btrim(p_action.input ->> 'scope'), ''),
          (select p.id from public.pages p where p.id = (p_action.input ->> 'parentPageId')::uuid and p.retired_at is null))
  returning id into v_page_id;
  for v_section in select value from jsonb_array_elements(coalesce(p_action.input -> 'sections', '[]')) loop
    perform change_control.insert_section(v_page_id, v_section ->> 'title', v_section -> 'query');
  end loop;
  update public.actions set target_id = v_page_id, undo_state = '{}' where id = p_action.id;
end $$;

-- ARTICLE INDEX: [{ id, title, type, scope, parentId, claimCount }] for every live page
create function public.article_index()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'title', p.title, 'type', p.article_type, 'scope', p.scope, 'parentId', p.parent_page_id,
    'claimCount', (select count(distinct cited) from public.section_lines sl cross join unnest(sl.unit_revision_ids) cited where sl.page_id = p.id)
  ) order by p.title), '[]'::jsonb)
  from public.pages p
  where p.retired_at is null;
$$;
revoke execute on function public.article_index() from public, anon, authenticated;
grant execute on function public.article_index() to service_role;
