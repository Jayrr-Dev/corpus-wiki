"use client";

import type { KeyboardEvent } from "react";
import type { Tables } from "@/lib/database/types";
import { type ShownLine, useChangeNotes } from "@/lib/queries";
import { cn } from "@/lib/utils";

// DATE FORMAT FOR CHANGE NOTES
const noteDate = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

type LiveSectionProps = {
  section: Tables<"sections">;
  lines: ShownLine[];
  selectedLineId: string | null;
  onSelect: (line: ShownLine) => void;
};

// LIVE SECTION: title, its lines (each clickable), a gold bar while stale or rebuilding, and the latest change note
export function LiveSection({ section, lines, selectedLineId, onSelect }: LiveSectionProps) {
  const isStale = section.status !== "current";
  return (
    <section aria-busy={section.status === "building"} className={cn("flex flex-col gap-2 border-l-2 pl-3", isStale ? "border-stale" : "border-transparent")}>
      <h2 className="border-b pb-1 text-body font-semibold">{section.title}</h2>
      {lines.length === 0 ? (
        <p className="text-body text-faint">{isStale ? "Not built yet." : "Nothing known yet."}</p>
      ) : (
        <p className="text-body">
          {lines.map((line) => (
            <LineSpan key={line.lineId} line={line} isSelected={line.lineId === selectedLineId} onSelect={onSelect} />
          ))}
        </p>
      )}
      <LatestChangeNote sectionId={section.id} />
    </section>
  );
}

type LineSpanProps = { line: ShownLine; isSelected: boolean; onSelect: (line: ShownLine) => void };

// ONE LINE: clickable, highlighted while selected, faint while a claim under it changed
function LineSpan({ line, isSelected, onSelect }: LineSpanProps) {
  const select = () => onSelect(line);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select();
    }
  };
  return (
    <>
      <span
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        onClick={select}
        onKeyDown={onKeyDown}
        className={cn("cursor-pointer rounded-sm hover:bg-hover", isSelected && "bg-hover", line.isStale && "text-faint")}
      >
        {line.content}
      </span>{" "}
    </>
  );
}

// LATEST CHANGE NOTE: "Updated …" in faint text with its date
function LatestChangeNote({ sectionId }: { sectionId: string }) {
  const { data: notes = [] } = useChangeNotes({ filters: { section_id: sectionId }, limit: 1 });
  const note = notes[0];
  if (!note) return null;
  return (
    <p className="text-panel text-faint">
      {note.summary} · {noteDate.format(new Date(note.created_at))}
    </p>
  );
}
