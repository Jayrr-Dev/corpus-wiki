"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { linkColumn, textColumn } from "@/app/(app)/_components/columns";
import { readsState } from "@/app/(app)/_lib/reads";
import { EmptyState } from "@/components/EmptyState";
import { DataTable } from "@/components/data-table";
import { EntityIcon } from "@/components/icons";
import { menuColumn } from "@/components/row-menu/RowMenu";
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
  textColumn<EntityRow>("state", "State", (entity) => (entity.retired_at ? "retired" : "current"), (entity) =>
    entity.retired_at ? <span className="text-faint">retired</span> : null,
  ),
  menuColumn<EntityRow>((entity) => <EntityRowMenu entity={entity} />),
] satisfies ColumnDef<EntityRow, unknown>[];

// ENTITIES TABLE
export function EntitiesTable() {
  return (
    <DataTable
      query={useEntityRows()}
      columns={COLUMNS}
      getRowId={(entity) => entity.id}
      filterPlaceholder="Search entities…"
      emptyState={<EmptyState icon={EntityIcon} title="No entities yet" />}
    />
  );
}

// Entities with the number of units about each
function useEntityRows() {
  const entities = useEntities();
  const unitEntities = useUnitEntities();
  const data = useMemo(() => {
    const counts = new Map<string, number>();
    (unitEntities.data ?? []).forEach((row) => counts.set(row.entity_id, (counts.get(row.entity_id) ?? 0) + 1));
    return (entities.data ?? []).map((entity) => ({ ...entity, unitCount: counts.get(entity.id) ?? 0 }));
  }, [entities.data, unitEntities.data]);
  return { data, ...readsState([entities, unitEntities]) };
}
