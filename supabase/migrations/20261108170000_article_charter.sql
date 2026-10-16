-- =====================================================================
-- SECOND BRAIN · ARTICLE CHARTER, ARTICLE TYPE AND SCOPE
-- =====================================================================
-- What steers which articles the wiki has:
--   workspace_settings.article_charter
--                    { purpose, audience, outOfScope }: what the wiki is
--                    for, who reads it, what never gets an article. Set
--                    on /settings; the Article Reviewer reads it.
--   pages.article_type
--                    entity | process | requirement | concept; null for a
--                    page made before types existed
--   pages.scope      one sentence: what the article covers and what it
--                    leaves to other pages
-- =====================================================================

alter table public.workspace_settings
  add column article_charter jsonb not null default '{}'::jsonb
    check (jsonb_typeof(article_charter) = 'object');

alter table public.pages
  add column article_type text check (article_type in ('entity', 'process', 'requirement', 'concept')),
  add column scope text check (scope is null or length(btrim(scope)) between 1 and 500);

create or replace function public.get_workspace_settings()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'aiModel', (select s.ai_model from public.workspace_settings s where s.id),
    'autoUpdateStale', coalesce((select s.auto_update_stale from public.workspace_settings s where s.id), true),
    'allowExternalKnowledge', coalesce((select s.allow_external_knowledge from public.workspace_settings s where s.id), false),
    'ourEntityId', (select s.our_entity_id from public.workspace_settings s where s.id),
    'articleCharter', coalesce((select s.article_charter from public.workspace_settings s where s.id), '{}'::jsonb)
  );
$$;

-- WRITE: keeps only the three known text fields, trimmed; empty ones are dropped
create function public.set_article_charter(p_charter jsonb)
returns jsonb
language sql
set search_path = ''
as $$
  insert into public.workspace_settings (id, article_charter, updated_at)
  values (true, (
    select coalesce(jsonb_object_agg(k, btrim(p_charter ->> k)), '{}'::jsonb)
    from unnest(array['purpose', 'audience', 'outOfScope']) k
    where jsonb_typeof(p_charter -> k) = 'string' and length(btrim(p_charter ->> k)) > 0
  ), now())
  on conflict (id) do update set article_charter = excluded.article_charter, updated_at = excluded.updated_at;
  select public.get_workspace_settings();
$$;

revoke execute on function public.set_article_charter(jsonb) from public, anon, authenticated;
grant execute on function public.set_article_charter(jsonb) to service_role;

-- ARTICLE REVIEWER: a fixed role whose instructions a person may override on /skills
alter table public.ai_role_instructions drop constraint ai_role_instructions_role_check;
alter table public.ai_role_instructions add constraint ai_role_instructions_role_check check
  (role in ('extract_knowledge','identify_entities','link_knowledge','organize_topics','define_concepts','plan_articles','write_articles','researcher','reviewer','domain_steward','article_reviewer'));
