"use client";

import Link from "next/link";
import { HoverCard } from "radix-ui";
import { SourceIcon } from "@/components/icons";
import { usePassage, useSource } from "@/lib/queries";
import { Loader } from "@/components/standard/loader";

// CITATION CHIP: one passage behind a unit, its quote and source, linking to that passage in the source.
// The quote is cut to three lines; hovering the chip shows the whole passage.
export function CitationChip({ passageId }: { passageId: string }) {
  const { data: passage } = usePassage(passageId);
  const { data: source } = useSource(passage?.source_id);
  if (!passage) return <Loader inline label="Loading source…" />;
  return (
    <HoverCard.Root openDelay={300} closeDelay={100}>
      <HoverCard.Trigger asChild>
        <Link
          href={`/sources/${passage.source_id}#passage-${passage.id}`}
          className="flex flex-col gap-1 rounded-md border px-2 py-1.5 text-panel hover:bg-hover"
        >
          <q className="line-clamp-3 text-muted-foreground">{passage.text}</q>
          <span className="flex items-center gap-1 text-link">
            <SourceIcon className="shrink-0" />
            <span className="truncate">{source?.title ?? "Source"}</span>
          </span>
        </Link>
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side="left"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="z-50 flex max-h-[60vh] w-96 flex-col gap-2 overflow-y-auto rounded-lg bg-popover p-3 text-panel text-popover-foreground shadow-md ring-1 ring-foreground/10"
        >
          <q className="whitespace-pre-line">{passage.text}</q>
          <span className="flex items-center gap-1 text-faint">
            <SourceIcon className="shrink-0" />
            <span>{source?.title ?? "Source"}</span>
          </span>
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
