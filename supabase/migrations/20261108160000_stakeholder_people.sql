-- =====================================================================
-- PEOPLE ON STAKEHOLDER CARDS
-- =====================================================================
-- A stakeholder can be a real person. Their card says what they do:
-- { title, organization, organizationEntityId, role } in entity_profiles.person,
-- written by the card writer from the claims (null for anyone else). The
-- organization links to that organization's own card when it has one.
-- =====================================================================

alter table public.entity_profiles add column person jsonb;

-- THE STAKEHOLDERS PAGE: the 20261108120000 list plus a person's title, employer and role
create or replace function public.stakeholder_cards()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'entityId', e.id, 'name', e.name, 'type', e.type, 'aliases', to_jsonb(e.aliases), 'description', e.description,
    'kind', p.kind, 'relation', p.relation, 'keyFacts', p.key_facts, 'functions', p.functions,
    'contacts', p.contacts, 'personContacts', p.person_contacts, 'hidden', p.hidden, 'generatedAt', p.generated_at,
    'web', p.web, 'webCheckedAt', p.web_checked_at, 'logoUrl', p.logo_url, 'person', p.person,
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
