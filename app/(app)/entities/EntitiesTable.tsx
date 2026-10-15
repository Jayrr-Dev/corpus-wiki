"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { linkColumn, textColumn } from "@/app/(app)/_components/columns";
import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { readsState } from "@/app/(app)/_lib/reads";
import { ENTITY_STATE_TONE } from "@/app/(app)/_lib/tone";
import { EmptyState } from "@/components/EmptyState";
import { DataTable } from "@/components/data-table";
import { EntityIcon } from "@/components/icons";
import { RowMenu, menuColumn } from "@/components/row-menu/RowMenu";
import type { Tables } from "@/lib/database/types";
import { useEntities, useUnitEntities } from "@/lib/queries";
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
  return (
    <DataTable
      query={useEntityRows(showRetired)}
      columns={COLUMNS}
      getRowId={(entity) => entity.id}
      filterPlaceholder="Search entities…"
      emptyState={<EmptyState icon={EntityIcon} title="No entities yet" />}
    />
  );
}

// Entities (retired hidden unless `showRetired`) with the number of units about each
function useEntityRows(showRetired: boolean) {
  const entities = useEntities();
  const unitEntities = useUnitEntities();
  const data = useMemo(() => {
    const counts = new Map<string, number>();
    (unitEntities.data ?? []).forEach((row) => counts.set(row.entity_id, (counts.get(row.entity_id) ?? 0) + 1));
    return (entities.data ?? [])
      .filter((entity) => showRetired || !entity.retired_at)
      .map((entity) => ({ ...entity, unitCount: counts.get(entity.id) ?? 0 }));
  }, [entities.data, unitEntities.data, showRetired]);
  return { data, ...readsState([entities, unitEntities]) };
}
