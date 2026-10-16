-- =====================================================================
-- STAKEHOLDER WEB CONTEXT AND LOGOS
-- =====================================================================
-- When external knowledge is allowed, each stakeholder is looked up on
-- the web once (again when its name or kind changes). What the web says
-- is kept only when the model is sure the pages describe the same party,
-- and it stays apart from the knowledge: shown on the card as "From the
-- web" with its links, never turned into claims. A logo is fetched from
-- the official website when one was found, into the public 'logos' bucket.
-- =====================================================================

alter table public.entity_profiles
  add column web jsonb,                -- { summary, facts: [{ label, value, sourceIndex }], website, sources: [{ title, url }] }; null: nothing found
  add column web_checked_at timestamptz,
  add column web_hash text,            -- the name and kind it was looked up under
  add column logo_url text;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('logos', 'logos', true) on conflict (id) do nothing;
  end if;
end $$;

-- THE STAKEHOLDERS PAGE: the 20261108100000 list plus web context and logo
create or replace function public.stakeholder_cards()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'entityId', e.id, 'name', e.name, 'type', e.type, 'aliases', to_jsonb(e.aliases), 'description', e.description,
    'kind', p.kind, 'relation', p.relation, 'keyFacts', p.key_facts, 'functions', p.functions,
    'contacts', p.contacts, 'personContacts', p.person_contacts, 'hidden', p.hidden, 'generatedAt', p.generated_at,
    'web', p.web, 'webCheckedAt', p.web_checked_at, 'logoUrl', p.logo_url,
    'claimCount', stats.claims, 'sourceCount', stats.sources, 'lastChangedAt', stats.changed,
    'stale', stats.changed is not null and p.generated_at is not null and stats.changed > p.generated_at,
    'isOurs', e.id = (select s.our_entity_id from public.workspace_settings s where s.id)
  ) order by stats.claims desc, e.name), '[]')
  from public.entity_profiles p
  join public.entities e on e.id = p.entity_id and e.retired_at is null and e.merged_into_id is null
  cross join lateral (
    select count(distinct u.id) claims, max(u.last_changed_at) changed,
      (select count(distinct ps.source_id) from public.passages ps where ps.id = any (array(
        select unnest(r.passage_ids) from public.unit_entities ue2 join public.units u2 on u2.id = ue2.unit_id and u2.retired_at is null
        join public.revisions r on r.id = u2.current_revision_id where ue2.entity_id = e.id))) sources
    from public.unit_entities ue join public.units u on u.id = ue.unit_id and u.retired_at is null
    where ue.entity_id = e.id
  ) stats
  where p.is_stakeholder
$$;
revoke all on function public.stakeholder_cards() from public, anon;
grant execute on function public.stakeholder_cards() to authenticated, service_role;

notify pgrst, 'reload schema';
