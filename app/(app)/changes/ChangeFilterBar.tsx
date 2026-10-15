"use client";

import { enumOptions, OptionSelect, type SelectOption } from "@/components/actions/OptionSelect";
import { Constants } from "@/lib/database/types";
import { CHANGE_KIND_LABEL } from "./filterChanges";
import type { ChangeFilterState } from "./useChangeFilters";

// FIXED OPTIONS
const STATUS_OPTIONS = enumOptions(Constants.public.Enums.change_set_status);
const BY_OPTIONS: SelectOption[] = [
  { value: "ai", label: "AI" },
  { value: "person", label: "Person" },
];
const KIND_OPTIONS: SelectOption[] = Object.entries(CHANGE_KIND_LABEL).map(([value, label]) => ({ value, label }));
const WHEN_OPTIONS: SelectOption[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "Last 7 days" },
  { value: "month", label: "Last 30 days" },
];

// FILTER BAR: status, proposer, kind and time, side by side (or stacked in the sidebar)
export function ChangeFilterBar({ filters, setFilter, vertical = false }: ChangeFilterState & { vertical?: boolean }) {
  return (
    <div className={vertical ? "flex flex-col gap-4 [&>*]:w-full" : "flex flex-wrap gap-2"}>
      <OptionSelect label="Status" value={filters.status} options={STATUS_OPTIONS} emptyLabel="Any status" onChange={(v) => setFilter("status", v)} />
      <OptionSelect label="Proposed by" value={filters.by} options={BY_OPTIONS} emptyLabel="Anyone" onChange={(v) => setFilter("by", v)} />
      <OptionSelect label="Type" value={filters.kind} options={KIND_OPTIONS} emptyLabel="Any type" onChange={(v) => setFilter("kind", v)} />
      <OptionSelect label="When" value={filters.when} options={WHEN_OPTIONS} emptyLabel="Any time" onChange={(v) => setFilter("when", v)} />
    </div>
  );
}
