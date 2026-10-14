"use client";

import { Facts, Note, QueryState, Section, TextLink, UnitLink } from "@/app/(app)/_components/bits";
import { readsState } from "@/app/(app)/_lib/reads";
import type { Tables } from "@/lib/database/types";
import { useEntity, usePages, useUnitEntities } from "@/lib/queries";
import { useUnitSummaries } from "@/lib/queries/screens";

// ENTITY DETAIL: name, type and aliases, its wiki page, then every unit about it
export function EntityDetail({ entityId }: { entityId: string }) {
  const query = useEntity(entityId);
  const entity = query.data;
  return (
    <QueryState query={query}>
      {entity ? (
        <div className="flex flex-col gap-6">
          <EntityHeader entity={entity} />
          <EntityUnits entityId={entity.id} />
        </div>
      ) : (
        <Note>No entity with this id.</Note>
      )}
    </QueryState>
  );
}

// HEADER: facts and the wiki page link when a page is about this entity
function EntityHeader({ entity }: { entity: Tables<"entities"> }) {
  const { data: pages = [] } = usePages({ filters: { entity_id: entity.id } });
  const page = pages[0];
  return (
    <Section title="Entity">
      <p className="text-body font-medium">{entity.name}</p>
      <Facts
        items={[
          ["Type", entity.type],
          ["Key", <span key="key" className="font-mono">{entity.key}</span>],
          ["Aliases", entity.aliases.join(", ") || "—"],
          ["Wiki page", page ? <TextLink key="page" href={`/p/${page.slug}`}>{page.title}</TextLink> : <span key="page" className="text-faint">None</span>],
        ]}
      />
    </Section>
  );
}

// UNITS ABOUT IT: each with its role (subject, object, mentioned)
function EntityUnits({ entityId }: { entityId: string }) {
  const links = useUnitEntities({ filters: { entity_id: entityId } });
  const units = useUnitSummaries((links.data ?? []).map((row) => row.unit_id));
  const roleById = new Map((links.data ?? []).map((row) => [row.unit_id, row.role]));
  const list = units.data ?? [];
  return (
    <Section title={`Units (${list.length})`}>
      <QueryState query={readsState([links, units])}>
        {list.length === 0 ? <Note>No units are about this entity yet.</Note> : null}
        <ul className="flex flex-col gap-2">
          {list.map((unit) => (
            <li key={unit.id} className="grid grid-cols-[6rem_1fr] gap-3 text-panel">
              <span className="text-muted-foreground">{roleById.get(unit.id)}</span>
              <UnitLink unit={unit} />
            </li>
          ))}
        </ul>
      </QueryState>
    </Section>
  );
}
