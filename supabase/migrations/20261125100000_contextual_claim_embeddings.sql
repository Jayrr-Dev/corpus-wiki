-- =====================================================================
-- CONTEXTUAL CLAIM EMBEDDINGS (#39)
-- =====================================================================
-- A claim is embedded with its context in front, so two entities' claims
-- with the same wording no longer get the same vector:
--   "Acme Inc. · Applies to: Plant 2 · Training is required annually"
-- The text is built in lib/knowledge/claimEmbeddingText.ts from the names
-- this file's stale_unit_embeddings returns. The topic path is left out on
-- purpose: topic filing reads these vectors to choose a topic.
--
-- unit_embeddings.text_version says which text a vector holds:
--   1  the bare claim (every vector saved before this migration)
--   2  the context prefix and the claim
--   0  a prefix that named an entity since renamed; still read, replaced soon
-- One vector per revision stays: a new text replaces the old one in place,
-- and rolling back is re-embedding with the older version.
-- B-tree indexes only (OrioleDB, AGENTS.md); no new index is needed.
-- =====================================================================

alter table public.unit_embeddings add column text_version smallint not null default 1;
comment on column public.unit_embeddings.text_version is
  'Which claim text was embedded: 1 bare claim, 2 context prefix and claim (lib/knowledge/claimEmbeddingText.ts), 0 a prefix with an entity name since changed.';

-- STALE: live claims whose current wording has no vector of this model and text version,
-- claims with no vector at all first (an upload's new claims before the backfill),
-- with the entity names and scope their prefix is built from
create function public.stale_unit_embeddings(p_model text, p_version integer, p_limit integer)
returns table (unit_id uuid, revision_id uuid, content text, subjects text[], scope text[], conditions text)
language sql
stable
set search_path = ''
as $$
  select u.id, r.id, r.content,
    array(select distinct e.name from jsonb_array_elements(coalesce(r.knowledge_context -> 'entities', '[]')) x
      join public.entities e on e.type = x ->> 'type' and e.key = x ->> 'key'
      where x ->> 'role' = 'subject' order by e.name),
    case when r.knowledge_context -> 'applicability' ->> 'status' = 'scoped' then
      array(select distinct e.name from jsonb_array_elements(coalesce(r.knowledge_context -> 'applicability' -> 'entities', '[]')) x
        join public.entities e on e.type = x ->> 'type' and e.key = x ->> 'key' order by e.name)
    else '{}'::text[] end,
    case when r.knowledge_context -> 'applicability' ->> 'status' = 'scoped'
      then nullif(btrim(r.knowledge_context -> 'applicability' ->> 'conditions'), '') end
  from public.units u
  join public.revisions r on r.id = u.current_revision_id
  where u.retired_at is null and btrim(r.content) <> ''
    and not exists (select 1 from public.unit_embeddings e where e.revision_id = r.id and e.model = p_model and e.text_version = p_version)
  order by exists (select 1 from public.unit_embeddings e where e.revision_id = r.id), u.created_at
  limit p_limit
$$;
revoke execute on function public.stale_unit_embeddings(text, integer, integer) from public, anon, authenticated;
grant execute on function public.stale_unit_embeddings(text, integer, integer) to service_role;

-- SAVE: as before, plus the text version (rows without one are bare text, version 1)
create or replace function public.save_unit_embeddings(p_rows jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_saved integer;
begin
  delete from public.unit_embeddings e
  using jsonb_array_elements(p_rows) x
  where e.revision_id = (x ->> 'revisionId')::uuid;
  insert into public.unit_embeddings (revision_id, unit_id, model, embedding, text_version)
  select distinct on ((x ->> 'revisionId')::uuid)
    (x ->> 'revisionId')::uuid, (x ->> 'unitId')::uuid, x ->> 'model', (x -> 'embedding')::text::extensions.vector,
    coalesce((x ->> 'textVersion')::smallint, 1)
  from jsonb_array_elements(p_rows) x;
  get diagnostics v_saved = row_count;
  return v_saved;
end $$;
revoke execute on function public.save_unit_embeddings(jsonb) from public, anon, authenticated;
grant execute on function public.save_unit_embeddings(jsonb) to service_role;

-- RENAME: an entity's new name reaches the vectors of the live claims whose prefix
-- names it (subject, or scoped applicability). Marked version 0, so they are still
-- read and the next embedding pass replaces them. A trigger, so Undo counts too.
-- Ids are collected first and updated by key (the preview OrioleDB engine has
-- panicked on bulk joined updates, 20261105180000_knowledge_context.sql).
create function change_control.entity_renamed()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_revisions uuid[];
begin
  select coalesce(array_agg(distinct r.id), '{}') into v_revisions
  from public.units u join public.revisions r on r.id = u.current_revision_id
  where u.retired_at is null and (
    u.id in (select ue.unit_id from public.unit_entities ue where ue.entity_id = new.id and ue.role = 'subject')
    or (r.knowledge_context -> 'applicability' ->> 'status' = 'scoped'
      and r.knowledge_context -> 'applicability' -> 'entities' @> jsonb_build_array(jsonb_build_object('type', new.type, 'key', new.key))));
  update public.unit_embeddings set text_version = 0 where revision_id = any(v_revisions) and text_version <> 0;
  return null;
end $$;
create trigger mark_renamed_entity_vectors after update of name on public.entities
for each row when (new.name is distinct from old.name)
execute function change_control.entity_renamed();

notify pgrst, 'reload schema';
