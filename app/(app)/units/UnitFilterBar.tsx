"use client";

import { enumOptions, OptionSelect, type SelectOption } from "@/components/actions/OptionSelect";
import { Constants, type Tables } from "@/lib/database/types";
import type { UnitFilterState } from "./useUnitFilters";

// FIXED OPTIONS (enum values from the generated constants)
const KIND_OPTIONS = enumOptions(Constants.public.Enums.unit_kind);
const STATUS_OPTIONS = enumOptions(Constants.public.Enums.epistemic_status);
const STATE_OPTIONS: SelectOption[] = [
  { value: "current", label: "Current" },
  { value: "retired", label: "Retired" },
  { value: "all", label: "Current and retired" },
];

type UnitFilterBarProps = UnitFilterState & {
  domains: readonly Tables<"domains">[];
  entities: readonly Tables<"entities">[];
};

// FILTER BAR: kind, status, domain, entity and current/retired, side by side
export function UnitFilterBar({ filters, setFilter, domains, entities }: UnitFilterBarProps) {
  const domainOptions = domains.map((domain) => ({ value: domain.id, label: domain.path }));
  const entityOptions = entities.map((entity) => ({ value: entity.id, label: entity.name }));
  return (
    <div className="flex flex-wrap gap-2">
      <OptionSelect label="Kind" value={filters.kind} options={KIND_OPTIONS} emptyLabel="Any kind" onChange={(v) => setFilter("kind", v)} />
      <OptionSelect label="Status" value={filters.status} options={STATUS_OPTIONS} emptyLabel="Any status" onChange={(v) => setFilter("status", v)} />
      <OptionSelect label="Domain" value={filters.domain} options={domainOptions} emptyLabel="Any domain" onChange={(v) => setFilter("domain", v)} />
      <OptionSelect label="Entity" value={filters.entity} options={entityOptions} emptyLabel="Any entity" onChange={(v) => setFilter("entity", v)} />
      <OptionSelect label="Current or retired" value={filters.state} options={STATE_OPTIONS} onChange={(v) => setFilter("state", v)} />
    </div>
  );
}
