"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs } from "radix-ui";
import { linkColumn, textColumn } from "@/app/(app)/_components/columns";
import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { readsState } from "@/app/(app)/_lib/reads";
import { ENTITY_STATE_TONE } from "@/app/(app)/_lib/tone";
import { EmptyState } from "@/components/EmptyState";
import { DataTable } from "@/components/data-table";
import { EntityIcon } from "@/components/icons";
import { RowMenu, menuColumn } from "@/components/row-menu/RowMenu";
import type { Tables } from "@/lib/database/types";
import { queryKeys, useEntities } from "@/lib/queries";
import { readAllPages } from "@/components/graph/readAllPages";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { EntityRowMenu } from "./EntityRowMenu";

type EntityRow = Tables<"entities"> & { unitCount: number };

// COLUMNS: name, type, key, aliases, how many units are about it, retired or not, and the "…" menu
const COLUMNS = [
  linkColumn<EntityRow>("name", "Name", (entity) => entity.name, (entity) => `/entities/${entity.id}`),
  textColumn<EntityRow>("type", "Type", (entity) => entity.type),
  textColumn<EntityRow>("key", "Key", (entity) => entity.key, (entity) => <span className="font-mono">{entity.key}</span>),
  textColumn<EntityRow>("aliases", "Aliases", (entity) => entity.aliases.join(", ")),
  { id: "units", header: "Units", accessorFn: (entity) => entity.unitCount, cell: ({ getValue }) => <span className="font-mono">{String(getValue())}</span> },
  textColumn<EntityRow>("state", "State", entityState, (entity) => (
    <StatusDot tone={ENTITY_STATE_TONE[entityState(entity)]} label={entityState(entity)} />
  )),
  menuColumn<EntityRow>((entity) => <EntityRowMenu entity={entity} />),
] satisfies ColumnDef<EntityRow, unknown>[];

// An entity is current until it is retired
function entityState(entity: EntityRow) {
  return entity.retired_at ? "retired" : "current";
}

// PAGE "…" MENU (header, beside New entity): show or hide retired entities (?retired=1)
export function EntitiesPageMenu({ showRetired }: { showRetired: boolean }) {
  return <RowMenu label="Entities" items={[{ label: showRetired ? "Hide retired" : "Show retired", href: showRetired ? "/entities" : "/entities?retired=1" }]} />;
}

// ENTITIES TABLE: current entities, plus retired ones when `showRetired`
export function EntitiesTable({ showRetired = false }: { showRetired?: boolean }) {
  const [scope, setScope] = useState("internal");
  const query = useEntityRows(showRetired, scope);
  return (
    <Tabs.Root value={scope} onValueChange={setScope} className="space-y-4">
      <Tabs.List aria-label="Entity source origin" className="flex gap-1 border-b">
        {(["internal", "external"] as const).map((origin) => (
          <Tabs.Trigger key={origin} value={origin} className={cn("border-b-2 px-3 py-2 text-panel transition-colors", scope === origin ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {origin === "internal" ? "Internal" : "External"}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <p className="text-panel text-muted-foreground">Grouped by the sources cited by each entity’s knowledge. Entities with both source types appear in both tabs. Entities without source links appear under Internal.</p>
      <Tabs.Content value={scope}>
    <DataTable
      query={query}
      columns={COLUMNS}
      getRowId={(entity) => entity.id}
      filterPlaceholder="Search entities…"
      emptyState={<EmptyState icon={EntityIcon} title={`No ${scope} entities yet`} />}
    />
      </Tabs.Content>
    </Tabs.Root>
  );
}

// Entities (retired hidden unless `showRetired`) with the number of units about each.
// The links and sources are read with only the columns the counts and tabs use.
function useEntityRows(showRetired: boolean, scope: string) {
  const entities = useEntities();
  const unitEntities = useQuery({
    queryKey: [...queryKeys.table("unit_entities"), "entity-unit-links"],
    queryFn: () => readAllPages((from, to) => getBrowserSupabase().from("unit_entities").select("unit_id, entity_id").order("unit_id").order("entity_id").order("role").range(from, to)),
  });
  const sources = useQuery({
    queryKey: [...queryKeys.table("sources"), "origins"],
    queryFn: () => readAllPages((from, to) => getBrowserSupabase().from("sources").select("id, origin").order("id").range(from, to)),
  });
  const sourceUnits = useQuery({
    queryKey: [...queryKeys.table("units"), "entity-source-links"],
    queryFn: () => readAllPages((from, to) => getBrowserSupabase().from("source_units").select("source_id, unit_id").order("source_id").order("unit_id").range(from, to)),
  });
  const data = useMemo(() => {
    const counts = new Map<string, number>();
    const origins = new Map((sources.data ?? []).map((source) => [source.id, source.origin]));
    const unitScopes = new Map<string, Set<string>>();
    for (const link of sourceUnits.data ?? []) {
      if (!link.unit_id || !link.source_id) continue;
      const origin = origins.get(link.source_id);
      if (!origin) continue;
      const scopes = unitScopes.get(link.unit_id) ?? new Set<string>();
      scopes.add(origin);
      unitScopes.set(link.unit_id, scopes);
    }
    const entityScopes = new Map<string, Set<string>>();
    (unitEntities.data ?? []).forEach((row) => {
      counts.set(row.entity_id, (counts.get(row.entity_id) ?? 0) + 1);
      const scopes = entityScopes.get(row.entity_id) ?? new Set<string>();
      for (const origin of unitScopes.get(row.unit_id) ?? ["internal"]) scopes.add(origin);
      entityScopes.set(row.entity_id, scopes);
    });
    return (entities.data ?? [])
      .filter((entity) => showRetired || !entity.retired_at)
      .filter((entity) => entityScopes.get(entity.id)?.has(scope) ?? scope === "internal")
      .map((entity) => ({ ...entity, unitCount: counts.get(entity.id) ?? 0 }));
  }, [entities.data, unitEntities.data, sources.data, sourceUnits.data, showRetired, scope]);
  return { data, ...readsState([entities, unitEntities, sources, sourceUnits]) };
}
