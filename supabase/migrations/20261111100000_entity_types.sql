-- =====================================================================
-- ENTITY TYPES. entities.type was free text, and (type, key) is an
-- entity's identity, so one thing saved under two words ("EPCOR" as a
-- company and as an organization) became two entities that cleanup then
-- had to merge. The types are now one fixed list (lib/knowledge/entityTypes.ts
-- holds the same rows) and entities.type references it.
--
-- Ten live entities are retyped in place, keeping their ids, pages and
-- profiles: the three countries -> place, five government bodies typed
-- organization -> government_body, and the Hazardous Products Act and
-- Regulations, typed policy -> legislation.
--
-- Claim revisions are immutable and name entities by (type, key), so each
-- old (type, key) stays behind as a stub merged into the retyped entity:
-- old references resolve through entity_canonical_id, as they do after any
-- merge. A merged row already holding the new (type, key) gives its slot up
-- (its key is suffixed); it was merged into the same entity, so references
-- to it now land on that entity directly. Section queries and pending
-- actions are moved to the new (type, key).
--
-- 'country' and 'law' stay listed as inactive: only old stubs carry them,
-- and nothing new may be saved under an inactive type.
-- =====================================================================

create table public.entity_types (
  type text primary key,
  parent_type text references public.entity_types (type),
  label text not null,
  description text not null,
  stakeholder boolean not null,
  active boolean not null default true,
  position integer not null
);
comment on table public.entity_types is 'The fixed list of entity types (lib/knowledge/entityTypes.ts). stakeholder: a party to the work, so it gets a stakeholder card. Inactive types only remain on old merged rows.';

alter table public.entity_types enable row level security;
create policy entity_types_read on public.entity_types for select to authenticated using (true);

insert into public.entity_types (type, parent_type, label, description, stakeholder, active, position) values
  ('organization', null, 'Organization', 'an association, institute or other body that is not a company or government', true, true, 1),
  ('company', 'organization', 'Company', 'a business: contractor, supplier, utility, manufacturer', true, true, 2),
  ('government_body', 'organization', 'Government body', 'a government, ministry, agency, regulator, program or municipality', true, true, 3),
  ('person', null, 'Person', 'a named individual', true, true, 4),
  ('role', null, 'Role', 'a job or function people hold: designer, inspector, administrator', true, true, 5),
  ('team', null, 'Team', 'a department, crew or working group', true, true, 6),
  ('place', null, 'Place', 'a country, province, city, site or region', true, true, 7),
  ('project', null, 'Project', 'a named project or program of work', false, true, 8),
  ('product', null, 'Product', 'a product or model that is made or sold', false, true, 9),
  ('tool', null, 'Tool', 'software or a digital system', false, true, 10),
  ('equipment', null, 'Equipment', 'physical equipment, machines or instruments', false, true, 11),
  ('document', null, 'Document', 'a template, form, report, manual or drawing', false, true, 12),
  ('standard', null, 'Standard', 'a published standard, code or specification (ISO, CSA, MIL-STD)', false, true, 13),
  ('legislation', null, 'Legislation', 'an act, law or regulation made by a government', false, true, 14),
  ('policy', null, 'Policy', 'a policy an organization sets for itself', false, true, 15),
  ('procedure', null, 'Procedure', 'a named procedure or process', false, true, 16),
  ('course', null, 'Course', 'a training course', false, true, 17),
  ('concept', null, 'Concept', 'a term or idea; use only when no other type fits', false, true, 18),
  ('country', null, 'Country (old)', 'replaced by place', true, false, 90),
  ('law', null, 'Law (old)', 'replaced by legislation', false, false, 91);

-- An entity list (claim context entities, scope entities) with each retyped (type, key) moved
create function pg_temp.retyped(p_list jsonb, p_pairs jsonb) returns jsonb language sql immutable as $$
  select case when jsonb_typeof(p_list) is distinct from 'array' then p_list else coalesce((
    select jsonb_agg(case when p.value is null then e.value else jsonb_set(e.value, '{type}', p.value -> 'to') end order by e.ordinality)
    from jsonb_array_elements(p_list) with ordinality e
    left join lateral (
      select value from jsonb_array_elements(p_pairs)
      where value ->> 'from' = e.value ->> 'type' and value ->> 'key' = e.value ->> 'key' limit 1
    ) p on true
  ), '[]'::jsonb) end
$$;

-- A knowledge context ({ entities, applicability: { entities } }) with its entity lists moved
create function pg_temp.retyped_context(p_context jsonb, p_pairs jsonb) returns jsonb language plpgsql immutable as $$
declare
  c jsonb := p_context;
begin
  if jsonb_typeof(c) is distinct from 'object' then return c; end if;
  if c ? 'entities' then c := jsonb_set(c, '{entities}', pg_temp.retyped(c -> 'entities', p_pairs)); end if;
  if jsonb_typeof(c -> 'applicability') = 'object' and c -> 'applicability' ? 'entities' then
    c := jsonb_set(c, '{applicability,entities}', pg_temp.retyped(c -> 'applicability' -> 'entities', p_pairs));
  end if;
  return c;
end $$;

-- A single { type, key } reference (a section query's entity), moved
create function pg_temp.retyped_ref(p_ref jsonb, p_pairs jsonb) returns jsonb language sql immutable as $$
  select case when jsonb_typeof(p_ref) is distinct from 'object' then p_ref else pg_temp.retyped(jsonb_build_array(p_ref), p_pairs) -> 0 end
$$;

-- Rows are read into a snapshot first, then written one by one by primary key: OrioleDB has
-- panicked on bulk updates driven by a scan or join (20261105180000_knowledge_context.sql).
do $$
declare
  v_government uuid[] := array[
    'cefad234-4832-4d71-8723-dc62ab981f77', -- City of Edmonton
    'b6a0bd92-c563-41d4-8b57-05dacd66520f', -- FAA
    '13f75e12-f125-4fbc-91f0-880620302000', -- Government of Canada
    'c056e82c-51d8-40e2-a90a-a0fc4b44745d', -- Health Canada
    'e1b68d56-9627-43c9-8fb8-55f4c55bcb8f'  -- Labour Program
  ]::uuid[];
  v_acts uuid[] := array[
    '8005bbb3-9e7d-4639-a9cc-e928910ead11', -- Hazardous Products Act (HPA)
    '13103560-251e-41e0-810c-229d551ae303'  -- Hazardous Products Regulations (HPR)
  ]::uuid[];
  v_rows jsonb;
  v_row jsonb;
  v_clash public.entities;
  v_pairs jsonb := '[]';
  v_snapshot jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'type', e.type, 'key', e.key, 'name', e.name, 'to',
    case when e.type = 'country' then 'place' when e.id = any (v_government) then 'government_body' else 'legislation' end)
    order by e.created_at, e.id), '[]')
  into v_rows
  from public.entities e
  where e.merged_into_id is null and e.retired_at is null
    and (e.type = 'country' or e.id = any (v_government) or (e.id = any (v_acts) and e.type = 'policy'));

  for v_row in select value from jsonb_array_elements(v_rows) loop
    select * into v_clash from public.entities where type = v_row ->> 'to' and key = v_row ->> 'key';
    if found then
      if v_clash.merged_into_id is null and v_clash.retired_at is null then
        raise exception 'Retyping % to % clashes with live entity %', v_row ->> 'id', v_row ->> 'to', v_clash.id;
      end if;
      update public.entities set key = v_clash.key || '--old-' || left(v_clash.id::text, 8) where id = v_clash.id;
    end if;
    update public.entities set type = v_row ->> 'to' where id = (v_row ->> 'id')::uuid;
    insert into public.entities (type, key, name, merged_into_id)
    values (v_row ->> 'type', v_row ->> 'key', v_row ->> 'name', (v_row ->> 'id')::uuid);
    v_pairs := v_pairs || jsonb_build_object('from', v_row ->> 'type', 'key', v_row ->> 'key', 'to', v_row ->> 'to');
  end loop;

  -- Section queries
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'query', jsonb_set(s.query, '{entity}', pg_temp.retyped_ref(s.query -> 'entity', v_pairs)))), '[]')
  into v_rows
  from public.sections s
  where jsonb_typeof(s.query -> 'entity') = 'object'
    and pg_temp.retyped_ref(s.query -> 'entity', v_pairs) is distinct from s.query -> 'entity';
  for v_snapshot in select value from jsonb_array_elements(v_rows) loop
    update public.sections set query = v_snapshot -> 'query' where id = (v_snapshot ->> 'id')::uuid;
  end loop;

  -- Pending actions: their entity lists, context and section query (a context must name live entities)
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'input', x.input)), '[]')
  into v_rows
  from public.actions a
  cross join lateral (select
    (case when a.input ? 'entities' then jsonb_set(a.input, '{entities}', pg_temp.retyped(a.input -> 'entities', v_pairs)) else a.input end)
    || case when jsonb_typeof(a.input -> 'context') = 'object' then jsonb_build_object('context', pg_temp.retyped_context(a.input -> 'context', v_pairs)) else '{}'::jsonb end
    || case when jsonb_typeof(a.input -> 'query' -> 'entity') = 'object' then jsonb_build_object('query', jsonb_set(a.input -> 'query', '{entity}', pg_temp.retyped_ref(a.input -> 'query' -> 'entity', v_pairs))) else '{}'::jsonb end
    as input) x
  where a.outcome = 'pending' and x.input is distinct from a.input;
  for v_snapshot in select value from jsonb_array_elements(v_rows) loop
    update public.actions set input = v_snapshot -> 'input' where id = (v_snapshot ->> 'id')::uuid;
  end loop;
end $$;

-- From here on a type off the list can't be saved
alter table public.entities add constraint entities_type_fkey foreign key (type) references public.entity_types (type);

-- ...and a new entity can't take an inactive type
create function public.entities_require_active_type() returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.entity_types t where t.type = new.type and t.active) then
    raise exception 'Entity type "%" is not in use; choose a type from public.entity_types', new.type;
  end if;
  return new;
end $$;
create trigger entities_require_active_type before insert or update of type on public.entities
  for each row execute function public.entities_require_active_type();

-- =====================================================================
-- CURRENT ENTITIES IN THE RECONCILER'S INPUT. A stored claim's context names
-- entities as they were when it was saved, some since merged (or, above,
-- retyped). The model copies that context into a revision, and Change control
-- rejects a context naming an inactive entity, so a revision of such a claim
-- failed. The input now names the entity each one became.
-- =====================================================================

-- An entity list with every { type, key } replaced by its live entity's; each (type, key, role) once
create function public.canonical_entity_refs(p_list jsonb)
returns jsonb
language sql stable
set search_path = ''
as $$
  select case when jsonb_typeof(p_list) is distinct from 'array' then p_list else coalesce((
    select jsonb_agg(v order by v ->> 'type', v ->> 'key', v ->> 'role')
    from (
      select distinct case when c.id is null then e.value
        else e.value || jsonb_build_object('type', c.type, 'key', c.key) end as v
      from jsonb_array_elements(p_list) e
      left join public.entities c on c.id = public.entity_id_for(e.value ->> 'type', e.value ->> 'key')
    ) t
  ), '[]'::jsonb) end
$$;

create function public.canonical_knowledge_context(p_context jsonb)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  c jsonb := p_context;
begin
  if jsonb_typeof(c) is distinct from 'object' then return c; end if;
  if c ? 'entities' then c := jsonb_set(c, '{entities}', public.canonical_entity_refs(c -> 'entities')); end if;
  if jsonb_typeof(c -> 'applicability') = 'object' and c -> 'applicability' ? 'entities' then
    c := jsonb_set(c, '{applicability,entities}', public.canonical_entity_refs(c -> 'applicability' -> 'entities'));
  end if;
  return c;
end $$;

alter function public.reconciliation_input(uuid) rename to reconciliation_input_before_entity_types;
create function public.reconciliation_input(p_event_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_set(base, '{existingUnits}', coalesce((
    select jsonb_agg(case when x ? 'context' then jsonb_set(x, '{context}', public.canonical_knowledge_context(x -> 'context')) else x end order by ordinality)
    from jsonb_array_elements(base -> 'existingUnits') with ordinality as e(x, ordinality)
  ), '[]'::jsonb))
  from (select public.reconciliation_input_before_entity_types(p_event_id) base) t
$$;
revoke all on function public.reconciliation_input(uuid) from public, anon, authenticated;
grant execute on function public.reconciliation_input(uuid) to service_role;
