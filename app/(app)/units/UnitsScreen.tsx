"use client";

import { useMemo } from "react";
import { EvidenceBadge } from "@/app/(app)/_components/bits";
import { dateColumn, textColumn } from "@/app/(app)/_components/columns";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { DataTable } from "@/components/data-table";
import { StatusGlyph, UnitIcon } from "@/components/icons";
import { menuColumn } from "@/components/row-menu/RowMenu";
import { useDomains, useEntities, useUnitDomains, useUnitEntities } from "@/lib/queries";
import { type UnitSummary, useUnitSummaries } from "@/lib/queries/screens";
import { readsState } from "@/app/(app)/_lib/reads";
import { filterUnits, type UnitFilters } from "./filterUnits";
import { UnitFilterBar } from "./UnitFilterBar";
import { UnitRowMenu } from "./UnitRowMenu";
import { useUnitFilters } from "./useUnitFilters";

// COLUMNS: status glyph, content, kind, last changed, and the "…" menu
const COLUMNS = [
  textColumn<UnitSummary>("status", "", (unit) => unit.epistemic_status, (unit) => <StatusGlyph status={unit.epistemic_status} />),
  textColumn<UnitSummary>("content", "Knowledge", (unit) => `${unit.label ?? ""} ${unit.content}`, (unit) => (
    <div className="max-w-xl whitespace-normal">
      <Link href={`/units/${unit.id}`} className="font-medium text-link hover:underline">{unit.label ?? unit.content}</Link>
      <EvidenceBadge evidence={unit.evidence} className="ml-2 text-xs" />
      <p className="mt-1 line-clamp-2 text-panel text-muted-foreground">{unit.content}</p>
    </div>
  )),
  textColumn<UnitSummary>("kind", "Kind", (unit) => unit.kind),
  dateColumn<UnitSummary>("changed", "Last changed", (unit) => unit.last_changed_at, true),
  menuColumn<UnitSummary>((unit) => <UnitRowMenu unit={unit} />),
];

// UNITS SCREEN: filter bar over the unit table
export function UnitsScreen() {
  const filterState = useUnitFilters();
  const query = useFilteredUnits(filterState.filters);
  const { data: domains = [] } = useDomains();
  const { data: entities = [] } = useEntities();
  return (
    <div className="flex flex-col gap-3">
      <div className="md:hidden"><UnitFilterBar {...filterState} domains={domains} entities={entities} /></div>
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

