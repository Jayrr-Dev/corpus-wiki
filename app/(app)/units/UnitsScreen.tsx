"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { ActorName } from "@/app/(app)/_components/ActorName";
import { EvidenceBadge } from "@/app/(app)/_components/bits";
import { dateColumn, textColumn } from "@/app/(app)/_components/columns";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { DataTable } from "@/components/data-table";
import { StatusGlyph, UnitIcon } from "@/components/icons";
import { menuColumn } from "@/components/row-menu/RowMenu";
import { useDomains, useEntities, useUnitDomains, useUnitEntities } from "@/lib/queries";
import { type UnitSummary, useUnitSummaries } from "@/lib/queries/screens";
import { useHydrated } from "@/app/(app)/_lib/hydrated";
import { readsState } from "@/app/(app)/_lib/reads";
import { domainSubtreeIds, filterUnits, type UnitFilters } from "./filterUnits";
import { StatusLegend } from "./StatusLegend";
import { UnitFilterBar } from "./UnitFilterBar";
import { UnitRowMenu } from "./UnitRowMenu";
import { useUnitFilters } from "./useUnitFilters";
import { contextDescription } from "@/lib/knowledge/contextSelection";

// COLUMNS: status glyph, content, kind, last changed, and the "…" menu
const COLUMNS = [
  {
    id: "status",
    header: () => <StatusLegend />,
    accessorFn: (unit) => unit.epistemic_status,
    enableSorting: false,
    cell: ({ row }) => <StatusGlyph status={row.original.epistemic_status} />,
  } satisfies ColumnDef<UnitSummary, unknown>,
  textColumn<UnitSummary>("content", "Knowledge", (unit) => `${unit.label ?? ""} ${unit.content}`, (unit) => (
    <div className="max-w-xl whitespace-normal">
      <Link href={`/units/${unit.id}`} className="font-medium text-link hover:underline">{unit.label ?? unit.content}</Link>
      <EvidenceBadge evidence={unit.evidence} className="ml-2 text-xs" />
      <p className="mt-1 line-clamp-2 text-panel text-muted-foreground">{unit.content}</p>
      <p className="mt-1 text-panel text-faint">{unit.context ? contextDescription(unit.context) : "Applicability unspecified"}</p>
    </div>
  )),
  textColumn<UnitSummary>("kind", "Kind", (unit) => unit.kind),
  textColumn<UnitSummary>("by", "Changed by", (unit) => unit.changedBy?.author_id ?? unit.changedBy?.model_version ?? "", (unit) =>
    unit.changedBy ? <ActorName kind={unit.changedBy.author} personId={unit.changedBy.author_id} model={unit.changedBy.model_version} /> : null),
  dateColumn<UnitSummary>("changed", "Last changed", (unit) => unit.last_changed_at, true),
  menuColumn<UnitSummary>((unit) => <UnitRowMenu unit={unit} />),
];

const PENDING = { data: [] as UnitSummary[], isPending: true, error: null };

// A domain's current units, across origins and including its descendants.
export function DomainUnitsTable({ domainId }: { domainId: string }) {
  const units = useUnitSummaries();
  const domains = useDomains();
  const unitDomains = useUnitDomains();
  const data = useMemo(() => {
    const ids = domainSubtreeIds(domains.data ?? [], domainId);
    const unitIds = new Set((unitDomains.data ?? []).filter((row) => ids.has(row.domain_id)).map((row) => row.unit_id));
    return (units.data ?? []).filter((unit) => !unit.retired_at && unitIds.has(unit.id));
  }, [units.data, domains.data, unitDomains.data, domainId]);
  return <DataTable
    query={{ data, ...readsState([units, domains, unitDomains]) }}
    columns={COLUMNS}
    getRowId={(unit) => unit.id}
    filterPlaceholder="Search units…"
    emptyState={<EmptyState icon={UnitIcon} title="No knowledge units" hint="This domain and its subdomains have no current units." />}
  />;
}

// UNITS SCREEN: filter bar over the unit table
export function UnitsScreen() {
  const filterState = useUnitFilters();
  // Until hydrated, render what the server did (no data): the cache may already hold reads made elsewhere
  const hydrated = useHydrated();
  const filtered = useFilteredUnits(filterState.filters);
  const query = hydrated ? filtered : PENDING;
  const { data: domains = [] } = useDomains();
  const { data: entities = [] } = useEntities();
  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Unit source origin" className="flex gap-1 border-b">
        {(["internal", "external"] as const).map((origin) => (
          <Link key={origin} href={`?${new URLSearchParams({ ...Object.fromEntries(Object.entries(filterState.filters).filter(([, value]) => Boolean(value))), origin }).toString()}`}
            aria-current={filterState.filters.origin === origin ? "page" : undefined}
            className={`border-b-2 px-3 py-2.5 text-panel ${filterState.filters.origin === origin ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {origin === "internal" ? "Internal" : "External"}
          </Link>
        ))}
      </nav>
      <div className="md:hidden"><UnitFilterBar {...filterState} domains={hydrated ? domains : []} entities={hydrated ? entities : []} /></div>
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

