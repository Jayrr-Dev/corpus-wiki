"use client";

import Link from "next/link";
import { SourceIcon } from "@/components/icons";
import { usePassage, useSource } from "@/lib/queries";

// CITATION CHIP: one passage behind a unit, its quote and source, linking to the source
export function CitationChip({ passageId }: { passageId: string }) {
  const { data: passage } = usePassage(passageId);
  const { data: source } = useSource(passage?.source_id);
  if (!passage) return <p className="text-panel text-faint">Loading source…</p>;
  return (
    <Link
      href={`/sources/${passage.source_id}`}
      className="flex flex-col gap-1 rounded-md border px-2 py-1.5 text-panel hover:bg-hover"
    >
      <q className="line-clamp-3 text-muted-foreground">{passage.text}</q>
      <span className="flex items-center gap-1 text-link">
        <SourceIcon className="shrink-0" />
        <span className="truncate">{source?.title ?? "Source"}</span>
      </span>
    </Link>
  );
}
