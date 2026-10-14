"use client";

import { Facts, Note, QueryState, Section, TextLink } from "@/app/(app)/_components/bits";
import { readsState } from "@/app/(app)/_lib/reads";
import { useUnitDomains, useUnitEntities } from "@/lib/queries";
import { useRowsByIds } from "@/lib/queries/screens";

// ABOUT: the entities the unit is about (with their role) and the domains it belongs to
export function UnitAbout({ unitId }: { unitId: string }) {
  const unitEntities = useUnitEntities({ filters: { unit_id: unitId } });
  const unitDomains = useUnitDomains({ filters: { unit_id: unitId } });
  const entities = useRowsByIds("entities", (unitEntities.data ?? []).map((row) => row.entity_id));
  const domains = useRowsByIds("domains", (unitDomains.data ?? []).map((row) => row.domain_id));
  const roleById = new Map((unitEntities.data ?? []).map((row) => [row.entity_id, row.role]));
  // LINK ITEMS: entities open their page; domains open the filtered unit list
  const entityItems = (entities.data ?? []).map((entity) => ({
    id: entity.id,
    href: `/entities/${entity.id}`,
    text: entity.name,
    note: roleById.get(entity.id),
  }));
  const domainItems = (domains.data ?? []).map((domain) => ({ id: domain.id, href: `/units?domain=${domain.id}`, text: domain.path }));
  return (
    <Section title="About">
      <QueryState query={readsState([unitEntities, unitDomains, entities, domains])}>
        <Facts
          items={[
            ["Entities", <LinkList key="entities" items={entityItems} />],
            ["Domains", <LinkList key="domains" items={domainItems} />],
          ]}
        />
      </QueryState>
    </Section>
  );
}

type LinkItem = { id: string; href: string; text: string; note?: string };

// COMMA-FREE LIST OF LINKS, each with an optional faint note (e.g. the entity role)
function LinkList({ items }: { items: LinkItem[] }) {
  if (items.length === 0) return <Note>None</Note>;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1">
      {items.map((item) => (
        <li key={item.id}>
          <TextLink href={item.href}>{item.text}</TextLink>
          {item.note ? <span className="ml-1 text-faint">{item.note}</span> : null}
        </li>
      ))}
    </ul>
  );
}
