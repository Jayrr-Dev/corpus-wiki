"use client";

import type { ReactNode } from "react";
import { Facts, Note, QueryState, Section, TextLink, UnitLink } from "@/app/(app)/_components/bits";
import { actorLabel, formatDate } from "@/app/(app)/_lib/format";
import { useActorLabel } from "@/app/(app)/_lib/useActorLabel";
import { readsState } from "@/app/(app)/_lib/reads";
import { Tooltip } from "@/components/standard/tooltip";
import type { Tables } from "@/lib/database/types";
import { useActions, useEntity, usePages, useUnitEntities } from "@/lib/queries";
import { useRowsByIds, useUnitDomainsFor, useUnitSummaries } from "@/lib/queries/screens";

// A change this soon after the entity was added is part of adding it, not an update
const UPDATED_AFTER_MS = 60_000;

// ENTITY DETAIL: name and description, its facts and wiki page, then every unit about it
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

// HEADER: the AI description, then facts: what it is, its wiki page, when and by whom it was
// added and last changed (only when it changed after it was added), and where it shows up
function EntityHeader({ entity }: { entity: Tables<"entities"> }) {
  const { data: pages = [] } = usePages({ filters: { entity_id: entity.id } });
  const page = pages[0];
  const history = useEntityHistory(entity.id, entity.created_at);
  const reach = useEntityReach(entity.id);
  const date = (value: string) => <span className="font-mono">{formatDate(value)}</span>;
  const rows: [string, ReactNode | null][] = [
    ["Type", entity.type],
    ["Key", <span key="key" className="font-mono">{entity.key}</span>],
    ["Aliases", entity.aliases.join(", ") || "—"],
    ["Wiki page", page ? <TextLink key="page" href={`/p/${page.slug}`}>{page.title}</TextLink> : <span key="page" className="text-faint">None</span>],
    ["Units", reach.unitCount === null ? null : String(reach.unitCount)],
    ["Domains", reach.domains.length > 0 ? <DomainList key="domains" domains={reach.domains} /> : null],
    ["Created", date(entity.created_at)],
    ["Created by", history.createdBy],
    ["Updated", history.updatedAt ? date(history.updatedAt) : null],
    ["Updated by", history.updatedAt ? history.updatedBy : null],
  ];
  return (
    <Section title="Entity">
      <p className="text-body font-medium">{entity.name}</p>
      {entity.description ? (
        <Tooltip content={`Written by ${actorLabel("ai", null, entity.description_model)} from the units that mention it${entity.description_updated_at ? ` · ${formatDate(entity.description_updated_at)}` : ""}`}>
          <p className="max-w-prose text-panel text-muted-foreground">{entity.description}</p>
        </Tooltip>
      ) : null}
      <Facts items={rows.filter((row): row is [string, ReactNode] => row[1] !== null)} />
    </Section>
  );
}

// DOMAINS SHOWN BEFORE "N more" (a company entity can sit in dozens)
const DOMAINS_SHOWN = 5;

// The busiest domains with how many of its units each holds
function DomainList({ domains }: { domains: { path: string; count: number }[] }) {
  const hidden = domains.length - DOMAINS_SHOWN;
  return (
    <>
      {domains.slice(0, DOMAINS_SHOWN).map(({ path, count }) => (
        <span key={path} className="block">{path} <span className="text-faint">· {count}</span></span>
      ))}
      {hidden > 0 ? <span className="block text-faint">{hidden} more</span> : null}
    </>
  );
}

// HISTORY: who added the entity (its create_entity action's change set) and its latest later
// change (rename, retire, merge...), counted only when it lands after the entity was added
function useEntityHistory(entityId: string, createdAt: string) {
  const actions = useActions({ filters: { target_id: entityId, outcome: "applied" } }).data ?? [];
  const created = actions.find((action) => action.type === "create_entity");
  const latest = actions
    .filter((action) => action.type !== "create_entity" && action.applied_at)
    .sort((a, b) => (a.applied_at ?? "").localeCompare(b.applied_at ?? ""))
    .at(-1);
  const sets = useRowsByIds("change_sets", [created?.change_set_id, latest?.change_set_id]).data ?? [];
  const label = useActorLabel();
  const actorOf = (setId: string | undefined) => {
    const set = sets.find((candidate) => candidate.id === setId);
    return set ? label(set.proposed_by, set.author_id, set.model_version) : null;
  };
  const updatedAt = latest?.applied_at && Date.parse(latest.applied_at) - Date.parse(createdAt) > UPDATED_AFTER_MS ? latest.applied_at : null;
  return { createdBy: actorOf(created?.change_set_id), updatedAt, updatedBy: actorOf(latest?.change_set_id) };
}

// REACH: how many units mention it and the domains those units sit in, busiest first
function useEntityReach(entityId: string) {
  const links = useUnitEntities({ filters: { entity_id: entityId } });
  const unitIds = (links.data ?? []).map((row) => row.unit_id);
  const unitDomains = useUnitDomainsFor(unitIds).data ?? [];
  const domains = useRowsByIds("domains", unitDomains.map((row) => row.domain_id)).data ?? [];
  const countByDomain = new Map<string, number>();
  for (const row of unitDomains) countByDomain.set(row.domain_id, (countByDomain.get(row.domain_id) ?? 0) + 1);
  return {
    unitCount: links.data ? new Set(unitIds).size : null,
    domains: domains
      .map((domain) => ({ path: domain.path, count: countByDomain.get(domain.id) ?? 0 }))
      .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path)),
  };
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
