"use client";

import { TextLink } from "@/app/(app)/_components/bits";
import { textColumn } from "@/app/(app)/_components/columns";
import { formatCount } from "@/app/(app)/_lib/format";
import { readsState } from "@/app/(app)/_lib/reads";
import { DomainTreeSelect } from "@/components/actions/DomainTreeSelect";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/EmptyState";
import { UnitIcon } from "@/components/icons";
import { InfoPopover } from "@/components/standard/info-popover";
import { PopoverDescription } from "@/components/ui/popover";
import type { Tables } from "@/lib/database/types";
import { useDomains, useUnitDomains } from "@/lib/queries";
import { type SectionKnowledge, type UnitSummary, useSectionKnowledge, useUnitSummaries } from "@/lib/queries/screens";
import { useMemo } from "react";
import { domainSubtreeIds } from "./filterUnits";
import { useUnitFilters } from "./useUnitFilters";

const COLUMNS = [
  textColumn<UnitSummary>("content", "Knowledge", (unit) => `${unit.label ?? ""} ${unit.content}`, (unit) => (
    <div className="max-w-xl whitespace-normal">
      <TextLink href={`/units/${unit.id}`} className="whitespace-normal">{unit.label ?? unit.content}</TextLink>
      {unit.label ? <p className="mt-1 line-clamp-2 text-panel text-muted-foreground">{unit.content}</p> : null}
    </div>
  )),
  textColumn<UnitSummary>("kind", "Kind", (unit) => unit.kind),
];

// Current units no live article cites, optionally limited to a domain and its children
export function unusedUnits(
  units: readonly UnitSummary[],
  sections: readonly SectionKnowledge[],
  domainId: string,
  domains: readonly Tables<"domains">[],
  unitDomains: readonly Tables<"unit_domains">[],
): UnitSummary[] {
  const used = new Set(sections.flatMap((section) => section.units.map((unit) => unit.id)));
  const domainIds = domainId ? domainSubtreeIds(domains, domainId) : null;
  const inDomain = domainIds ? new Set(unitDomains.filter((row) => domainIds.has(row.domain_id)).map((row) => row.unit_id)) : null;
  return units.filter((unit) => !unit.retired_at && !used.has(unit.id) && (!inDomain || inDomain.has(unit.id)));
}

// UNUSED TAB: current knowledge that no article cites
export function UnusedUnits() {
  const { filters, setFilter } = useUnitFilters();
  const units = useUnitSummaries();
  const sectionKnowledge = useSectionKnowledge();
  const domains = useDomains();
  const unitDomains = useUnitDomains();
  const domainReady = !filters.domain || (domains.isSuccess && unitDomains.isSuccess);
  const unused = useMemo(
    () => unusedUnits(units.data ?? [], sectionKnowledge.data ?? [], domainReady ? filters.domain : "", domains.data ?? [], unitDomains.data ?? []),
    [units.data, sectionKnowledge.data, domains.data, unitDomains.data, filters.domain, domainReady],
  );
  const ready = units.isSuccess && sectionKnowledge.isSuccess && domainReady;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <p className="font-mono text-panel">{ready ? formatCount(unused.length) : "—"}</p>
        <InfoPopover label="About unused knowledge">
          <PopoverDescription>Current knowledge that no article cites.</PopoverDescription>
        </InfoPopover>
      </div>
      <DataTable
        query={{ data: unused, ...readsState([units, sectionKnowledge]) }}
        columns={COLUMNS}
        getRowId={(unit) => unit.id}
        filterPlaceholder="Search unused knowledge…"
        toolbarEnd={<DomainTreeSelect label="Domain" value={filters.domain} domains={domains.data ?? []} emptyLabel="Any domain" onChange={(value) => setFilter("domain", value)} />}
        emptyState={<EmptyState icon={UnitIcon} title="No unused knowledge" hint={filters.domain ? "This domain has no unused knowledge." : "Every current unit is cited by an article."} />}
      />
    </div>
  );
}
