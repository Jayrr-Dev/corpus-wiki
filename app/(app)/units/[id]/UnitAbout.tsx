"use client";

import Link from "next/link";
import { Facts, Note, QueryState, Section } from "@/app/(app)/_components/bits";
import { readsState } from "@/app/(app)/_lib/reads";
import { useUnitDomains, useUnitEntities, useEntities } from "@/lib/queries";
import { useRowsByIds } from "@/lib/queries/screens";
import { parseKnowledgeContext } from "@/lib/knowledge/context";
import { UnitContextEditor } from "./UnitContextEditor";

// ABOUT: the entities the unit is about (with their role) and the domains it belongs to
export function UnitAbout({ unitId }: { unitId: string }) {
  const unit = useRowsByIds("units", [unitId]);
  const revision = useRowsByIds("revisions", [unit.data?.[0]?.current_revision_id]);
  const allEntities = useEntities();
  const current = revision.data?.[0];
  const context = parseKnowledgeContext(current?.knowledge_context);
  const scope = context?.applicability;
  const scopeNames = scope?.entities.map(ref => (allEntities.data ?? []).find(entity => entity.type === ref.type && entity.key === ref.key)?.name ?? ref.key).join(", ");
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
            ["Applies to", scope?.status === "scoped" ? scopeNames : scope?.status === "general" ? "General knowledge" : "Unspecified"],
            ["Conditions", scope?.conditions ?? "None recorded"],
          ]}
        />
        {current && (Object.hasOwn(current, "knowledge_context") ? <UnitContextEditor key={current.id} revision={current} context={context} /> : <Note>Context editing will be available after the database update is applied.</Note>)}
      </QueryState>
    </Section>
  );
}

type LinkItem = { id: string; href: string; text: string; note?: string };

// CHIPS: one per link, with its optional note (e.g. the entity role) as a small header above the name
function LinkList({ items }: { items: LinkItem[] }) {
  if (items.length === 0) return <Note>None</Note>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <li key={item.id}>
          <Link href={item.href} className="flex flex-col rounded-md border px-2 py-1 transition-colors hover:bg-hover">
            {item.note ? <span className="text-xs leading-tight text-faint">{item.note}</span> : null}
            <span className="leading-tight text-link">{item.text}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
