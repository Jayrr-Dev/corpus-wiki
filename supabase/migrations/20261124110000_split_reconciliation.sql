-- =====================================================================
-- SPLIT RECONCILIATION (issue #45), behind RECONCILE_CLIENT=split
-- Extraction reads passages without the store, so its answer depends only
-- on the text and the prompt: it is cached by a hash of both. Resolution
-- then compares each draft claim with a small neighborhood of stored
-- claims, read here by id instead of loading the whole store.
--
--   extraction_cache        one extraction answer per (space, cache key)
--   read_extraction_cache   the saved answer, or null
--   save_extraction_cache   saves an answer (first writer wins)
--   reconciliation_units    live claims by id, shaped like reconciliation_input's existingUnits
-- =====================================================================

create table public.extraction_cache (
  space_id uuid not null default public.current_space_id() references public.spaces(id) on delete cascade,
  cache_key text not null check (length(cache_key) between 1 and 200),
  answer jsonb not null check (jsonb_typeof(answer) = 'object'),
  created_at timestamptz not null default now(),
  primary key (space_id, cache_key)
);
alter table public.extraction_cache enable row level security;
alter table public.extraction_cache force row level security;
create policy space_server on public.extraction_cache for all to space_runtime
  using (space_id = (select public.current_space_id())) with check (space_id = (select public.current_space_id()));
grant select, insert, update, delete on public.extraction_cache to space_runtime;

create function public.read_extraction_cache(p_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select c.answer from public.extraction_cache c
  where c.space_id = public.current_space_id() and c.cache_key = p_key
$$;

create function public.save_extraction_cache(p_key text, p_answer jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.extraction_cache (space_id, cache_key, answer)
  values (public.current_space_id(), p_key, p_answer)
  on conflict (space_id, cache_key) do nothing
$$;

-- The same fields reconciliation_input gives each existing unit, for the live claims named
create function public.reconciliation_units(p_unit_ids uuid[])
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'unitId', u.id, 'revisionId', r.id, 'content', r.content, 'kind', u.kind,
    'epistemicStatus', u.epistemic_status, 'sourceDate', r.source_date, 'passageIds', to_jsonb(r.passage_ids),
    'context', public.canonical_knowledge_context(coalesce(r.knowledge_context, 'null'::jsonb)),
    'structure', r.structure,
    'memberUnitIds', coalesce((
      select jsonb_agg(l.from_unit_id order by l.position nulls last, l.created_at, l.id)
      from public.relationships l join public.units m on m.id = l.from_unit_id and m.space_id = l.space_id
      where l.to_unit_id = u.id and l.space_id = u.space_id and l.type = 'part_of' and l.retired_at is null and m.retired_at is null
    ), '[]'::jsonb)
  ) order by u.created_at, u.id), '[]'::jsonb)
  from public.units u join public.revisions r on r.id = u.current_revision_id and r.space_id = u.space_id
  where u.space_id = public.current_space_id() and u.id = any(p_unit_ids) and u.retired_at is null
$$;

revoke all on function public.read_extraction_cache(text) from public, anon, authenticated;
revoke all on function public.save_extraction_cache(text, jsonb) from public, anon, authenticated;
revoke all on function public.reconciliation_units(uuid[]) from public, anon, authenticated;
grant execute on function public.read_extraction_cache(text) to service_role, space_runtime;
grant execute on function public.save_extraction_cache(text, jsonb) to service_role, space_runtime;
grant execute on function public.reconciliation_units(uuid[]) to service_role, space_runtime;
