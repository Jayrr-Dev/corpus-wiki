-- =====================================================================
-- STAKEHOLDER STRUCTURE: the links claims label between stakeholders
-- =====================================================================
-- A claim may carry knowledge_context.structure: StructureLabel[] from
-- lib/stakeholders/structure.ts (from, link, to, title, seniority, share,
-- current). The link and seniority lists below are that file's lists.
-- 1. TABLE. public.entity_relations holds each claim's labels, one row
--    per (claim, from, link, to), with both ends resolved to the entity
--    that stayed when the claim was saved.
-- 2. PROJECTION. Saving a claim re-projects its labels next to its
--    entities. Like unit_entities, a retired claim's rows stay and stop
--    counting in the read; a later merge resolves at read time.
-- 3. VALIDATION. A label must use a known link and seniority, a share
--    from 0 to 1, and join two of the claim's own entities. A context
--    without structure stays valid.
-- 4. READ. public.stakeholder_structure() returns StructureRelation[]:
--    one per (from, link, to) over live claims, the latest claim's
--    title, seniority, share and current winning.
-- =====================================================================


-- =====================================================================
-- 1. TABLE
-- =====================================================================

grant create on schema public, change_control to space_runtime;

create table public.entity_relations (
  space_id uuid not null default public.current_space_id() references public.spaces (id) on delete cascade,
  unit_id uuid not null,
  from_entity_id uuid not null,
  to_entity_id uuid not null,
  link text not null check (link in (
    'part_of', 'owned_by', 'leads', 'board_member_of', 'works_in', 'reports_to',
    'regulates', 'funds', 'contracts_with')),
  title text,
  seniority text check (seniority in (
    'owner', 'elected_leader', 'board', 'elected_member', 'executive', 'top_official',
    'vice_president', 'director', 'manager', 'lead', 'staff', 'entry', 'advisor')),
  share numeric check (share between 0 and 1),
  current boolean not null default true,
  primary key (space_id, unit_id, from_entity_id, link, to_entity_id),
  foreign key (space_id, unit_id) references public.units (space_id, id),
  foreign key (space_id, from_entity_id) references public.entities (space_id, id),
  foreign key (space_id, to_entity_id) references public.entities (space_id, id)
);
comment on table public.entity_relations is 'Structure links a claim labels between two entities (knowledge_context.structure), projected like unit_entities.';
create index entity_relations_from_idx on public.entity_relations (space_id, from_entity_id, link);
create index entity_relations_to_idx on public.entity_relations (space_id, to_entity_id, link);
alter table public.entity_relations enable row level security;
alter table public.entity_relations force row level security;
create policy space_server on public.entity_relations for all to space_runtime
  using (space_id = (select public.current_space_id())) with check (space_id = (select public.current_space_id()));
create policy space_browser_boundary on public.entity_relations for select to authenticated
  using (space_id = any (array(select unnest(public.readable_space_ids()))));
grant select on public.entity_relations to authenticated;
grant select, insert, update, delete on public.entity_relations to space_runtime;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables p where p.pubname = 'supabase_realtime' and p.schemaname = 'public' and p.tablename = 'entity_relations') then
    alter publication supabase_realtime add table public.entity_relations;
  end if;
end $$;


-- =====================================================================
-- 2. PROJECTION
-- =====================================================================

-- The 20261115100000 projection (inside a commit and outside it), then this claim's labels
alter function change_control.project_knowledge_context(uuid) rename to project_knowledge_context_before_structure;
create function change_control.project_knowledge_context(p_unit uuid)
returns uuid[]
language plpgsql
set search_path = ''
as $$
declare
  c jsonb;
  affected uuid[];
begin
  affected := change_control.project_knowledge_context_before_structure(p_unit);
  select r.knowledge_context into c from public.units u join public.revisions r on r.id = u.current_revision_id where u.id = p_unit;
  delete from public.entity_relations where unit_id = p_unit;
  insert into public.entity_relations (unit_id, from_entity_id, to_entity_id, link, title, seniority, share, current)
  select p_unit, ends.from_id, ends.to_id, x ->> 'link', nullif(btrim(x ->> 'title'), ''), x ->> 'seniority',
    (x ->> 'share')::numeric, coalesce((x ->> 'current')::boolean, true)
  from jsonb_array_elements(case when jsonb_typeof(c -> 'structure') = 'array' then c -> 'structure' else '[]'::jsonb end) x
  cross join lateral (select public.entity_id_for(x -> 'from' ->> 'type', x -> 'from' ->> 'key') from_id,
                             public.entity_id_for(x -> 'to' ->> 'type', x -> 'to' ->> 'key') to_id) ends
  where ends.from_id is not null and ends.to_id is not null
  on conflict do nothing;
  return affected;
end $$;


-- =====================================================================
-- 3. VALIDATION
-- =====================================================================

alter function change_control.validate_knowledge_context(jsonb) rename to validate_knowledge_context_before_structure;
create function change_control.validate_knowledge_context(c jsonb) returns void language plpgsql set search_path='' as $$
declare s jsonb; own uuid[];
begin
 perform change_control.validate_knowledge_context_before_structure(c);
 if jsonb_typeof(c->'structure') is null or jsonb_typeof(c->'structure')='null' then return; end if;
 if jsonb_typeof(c->'structure')<>'array' then raise exception 'Invalid structure in knowledge context'; end if;
 select coalesce(array_agg(public.entity_id_for(e->>'type',e->>'key')),'{}') into own from jsonb_array_elements(c->'entities') e;
 for s in select value from jsonb_array_elements(c->'structure') loop
  if jsonb_typeof(s)<>'object' or coalesce(s->>'link','') not in (
   'part_of','owned_by','leads','board_member_of','works_in','reports_to','regulates','funds','contracts_with') then
   raise exception 'Unknown structure link';
  end if;
  if s->>'seniority' is not null and s->>'seniority' not in (
   'owner','elected_leader','board','elected_member','executive','top_official',
   'vice_president','director','manager','lead','staff','entry','advisor') then
   raise exception 'Unknown seniority in structure link';
  end if;
  if coalesce(jsonb_typeof(s->'title'),'null') not in ('string','null')
  or coalesce(jsonb_typeof(s->'current'),'null') not in ('boolean','null')
  or (coalesce(jsonb_typeof(s->'share'),'null')<>'null' and (jsonb_typeof(s->'share')<>'number' or (s->>'share')::numeric not between 0 and 1)) then
   raise exception 'Invalid structure link';
  end if;
  if not coalesce(public.entity_id_for(s->'from'->>'type',s->'from'->>'key')=any(own),false)
  or not coalesce(public.entity_id_for(s->'to'->>'type',s->'to'->>'key')=any(own),false) then
   raise exception 'A structure link must join entities of the claim';
  end if;
 end loop;
end $$;

revoke all on function change_control.project_knowledge_context(uuid), change_control.validate_knowledge_context(jsonb) from public, anon, authenticated;
grant execute on function change_control.project_knowledge_context(uuid), change_control.validate_knowledge_context(jsonb) to service_role, space_runtime;
alter function change_control.project_knowledge_context(uuid) owner to space_runtime;
alter function change_control.validate_knowledge_context(jsonb) owner to space_runtime;


-- =====================================================================
-- 4. READ
-- =====================================================================

-- EVERY LINK: merged ends resolved, one per (from, link, to) over live claims between live
-- entities (a link a merge folded onto one entity is left out), the latest claim winning
create function public.stakeholder_structure()
returns jsonb language sql stable security definer set search_path = '' as $$
  with live as (
    select public.entity_canonical_id(er.from_entity_id) from_id, er.link, public.entity_canonical_id(er.to_entity_id) to_id,
      er.unit_id, jsonb_build_object('title', er.title, 'seniority', er.seniority, 'share', er.share, 'current', er.current) seat,
      u.last_changed_at changed
    from public.entity_relations er join public.units u on u.id = er.unit_id and u.retired_at is null
  ), grouped as (
    select from_id, link, to_id,
      (array_agg(seat order by changed desc, unit_id desc))[1] latest,
      array_agg(distinct unit_id) unit_ids
    from live where from_id <> to_id
    group by from_id, link, to_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'fromId', g.from_id, 'toId', g.to_id, 'link', g.link,
    'title', g.latest -> 'title', 'seniority', g.latest -> 'seniority', 'share', g.latest -> 'share', 'current', g.latest -> 'current',
    'unitIds', to_jsonb(g.unit_ids)
  ) order by g.from_id, g.link, g.to_id), '[]')
  from grouped g
  join public.entities f on f.id = g.from_id and f.retired_at is null
  join public.entities t on t.id = g.to_id and t.retired_at is null
$$;
alter function public.stakeholder_structure() owner to space_runtime;
revoke create on schema public, change_control from space_runtime;
revoke all on function public.stakeholder_structure() from public, anon, authenticated;
grant execute on function public.stakeholder_structure() to authenticated, service_role, space_runtime;


notify pgrst, 'reload schema';
