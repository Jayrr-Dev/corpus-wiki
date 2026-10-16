"use client";

import { useMemo } from "react";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { DataTable } from "@/components/data-table";
import { EvidenceBadge } from "@/app/(app)/_components/bits";
import { textColumn } from "@/app/(app)/_components/columns";
import { useHydrated } from "@/app/(app)/_lib/hydrated";
import { contextDescription } from "@/lib/knowledge/contextSelection";
import { type UnitSummary, useUnitSummaries } from "@/lib/queries/screens";

const COLUMNS = [
  textColumn<UnitSummary>("term", "Term", (unit) => unit.label || unit.content, (unit) => (
    <Link href={`/units/${unit.id}`} className="font-medium whitespace-normal text-link hover:underline">
      {unit.label || unit.content}
    </Link>
  )),
  textColumn<UnitSummary>("definition", "Definition", (unit) => unit.content, (unit) => (
    <div className="max-w-2xl whitespace-normal">
      <p>{unit.content}</p>
      <EvidenceBadge evidence={unit.evidence} className="mt-2 text-xs" />
    </div>
  )),
  textColumn<UnitSummary>("context", "Applies to", (unit) => unit.context ? contextDescription(unit.context) : "Applicability unspecified", (unit) => (
    <span className="whitespace-normal text-muted-foreground">
      {unit.context ? contextDescription(unit.context) : "Applicability unspecified"}
    </span>
  )),
];

export function GlossaryScreen() {
  const units = useUnitSummaries();
  const hydrated = useHydrated();
  const data = useMemo(() => (units.data ?? [])
    .filter((unit) => unit.kind === "definition" && !unit.retired_at)
    .sort((a, b) => (a.label || a.content).localeCompare(b.label || b.content)), [units.data]);

  return <DataTable
    query={{ data: hydrated ? data : [], isPending: !hydrated || units.isPending, error: units.error }}
    columns={COLUMNS}
    getRowId={(unit) => unit.id}
    filterPlaceholder="Search terms, acronyms, or definitions…"
    emptyState={<EmptyState icon={BookOpen} title="No definitions yet" hint="Upload a source that explains terms or acronyms. Supported definitions will appear here automatically as it is processed." />}
  />;
}
