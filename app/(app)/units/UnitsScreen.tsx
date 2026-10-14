"use client";

import { useMemo } from "react";
import { dateColumn, linkColumn, textColumn } from "@/app/(app)/_components/columns";
import { EmptyState } from "@/components/EmptyState";
import { DataTable } from "@/components/data-table";
import { StatusGlyph, UnitIcon } from "@/components/icons";
import { useDomains, useEntities, useUnitDomains, useUnitEntities } from "@/lib/queries";
import { type UnitSummary, useUnitSummaries } from "@/lib/queries/screens";
import { readsState } from "@/app/(app)/_lib/reads";
import { filterUnits, type UnitFilters } from "./filterUnits";
import { UnitFilterBar } from "./UnitFilterBar";
import { useUnitFilters } from "./useUnitFilters";

// COLUMNS: status glyph, content, kind, last changed
const COLUMNS = [
  textColumn<UnitSummary>("status", "", (unit) => unit.epistemic_status, (unit) => <StatusGlyph status={unit.epistemic_status} />),
  linkColumn<UnitSummary>("content", "Content", (unit) => unit.content, (unit) => `/units/${unit.id}`),
  textColumn<UnitSummary>("kind", "Kind", (unit) => unit.kind),
  dateColumn<UnitSummary>("changed", "Last changed", (unit) => unit.last_changed_at, true),
];

// UNITS SCREEN: filter bar over the unit table
export function UnitsScreen() {
  const filterState = useUnitFilters();
  const query = useFilteredUnits(filterState.filters);
  const { data: domains = [] } = useDomains();
  const { data: entities = [] } = useEntities();
  return (
    <div className="flex flex-col gap-3">
      <UnitFilterBar {...filterState} domains={domains} entities={entities} />
      <DataTable
        query={query}
        columns={COLUMNS}
        getRowId={(unit) => unit.id}
        filterPlaceholder="Search units…"
        emptyState={<EmptyState icon={UnitIcon} title="No units match" hint="Upload a file or change the filters." />}
      />
    </div>
  );
}

// Units with every filter applied; pending/error from any of the reads it joins
function useFilteredUnits(filters: UnitFilters) {
  const units = useUnitSummaries();
  const unitDomains = useUnitDomains();
  const unitEntities = useUnitEntities();
  const domains = useDomains();
  const reads = [units, unitDomains, unitEntities, domains];
  const data = useMemo(
    () =>
      filterUnits(units.data ?? [], filters, {
        unitDomains: unitDomains.data ?? [],
        unitEntities: unitEntities.data ?? [],
        domains: domains.data ?? [],
      }),
    [units.data, unitDomains.data, unitEntities.data, domains.data, filters],
  );
  return { data, ...readsState(reads) };
}
