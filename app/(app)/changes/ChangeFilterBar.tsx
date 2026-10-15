"use client";

import { useMemo } from "react";
import { modelName } from "@/app/(app)/_lib/format";
import { enumOptions, OptionSelect, type SelectOption } from "@/components/actions/OptionSelect";
import { Constants } from "@/lib/database/types";
import { useChangeSets, useProfiles } from "@/lib/queries";
import { CHANGE_KIND_LABEL } from "./filterChanges";
import type { ChangeFilterState } from "./useChangeFilters";

// FIXED OPTIONS
const STATUS_OPTIONS = enumOptions(Constants.public.Enums.change_set_status);
const BY_KIND_OPTIONS: SelectOption[] = [
  { value: "ai", label: "AI (any model)" },
  { value: "person", label: "People (anyone)" },
];
const KIND_OPTIONS: SelectOption[] = Object.entries(CHANGE_KIND_LABEL).map(([value, label]) => ({ value, label }));
const WHEN_OPTIONS: SelectOption[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "Last 7 days" },
  { value: "month", label: "Last 30 days" },
];

// PROPOSERS: AI or people as a whole, then each person and each model that proposed a change
function useProposerOptions(): SelectOption[] {
  const changeSets = useChangeSets().data;
  const profiles = useProfiles().data;
  return useMemo(() => {
    const people = (profiles ?? []).map((profile) => ({ value: `person:${profile.id}`, label: profile.display_name || profile.email || "Person" }));
    const models = [...new Set((changeSets ?? []).flatMap((set) => (set.proposed_by === "ai" && set.model_version ? [set.model_version] : [])))]
      .sort()
      .map((model) => ({ value: `model:${model}`, label: `AI · ${modelName(model)}` }));
    return [...BY_KIND_OPTIONS, ...people, ...models];
  }, [changeSets, profiles]);
}

// FILTER BAR: status, proposer, kind and time, side by side (or stacked in the sidebar)
export function ChangeFilterBar({ filters, setFilter, vertical = false }: ChangeFilterState & { vertical?: boolean }) {
  const byOptions = useProposerOptions();
  return (
    <div className={vertical ? "flex flex-col gap-4 [&>*]:w-full" : "flex flex-wrap gap-2"}>
      <OptionSelect label="Status" value={filters.status} options={STATUS_OPTIONS} emptyLabel="Any status" onChange={(v) => setFilter("status", v)} />
      <OptionSelect label="Proposed by" value={filters.by} options={byOptions} emptyLabel="Anyone" onChange={(v) => setFilter("by", v)} />
      <OptionSelect label="Type" value={filters.kind} options={KIND_OPTIONS} emptyLabel="Any type" onChange={(v) => setFilter("kind", v)} />
      <OptionSelect label="When" value={filters.when} options={WHEN_OPTIONS} emptyLabel="Any time" onChange={(v) => setFilter("when", v)} />
    </div>
  );
}
