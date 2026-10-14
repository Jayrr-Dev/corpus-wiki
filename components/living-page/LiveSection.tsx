"use client";

import type { KeyboardEvent } from "react";
import type { Tables } from "@/lib/database/types";
import { type BodySpan, splitBody } from "@/lib/living-page/sentences";
import type { SentenceLink } from "@/lib/living-page/types";
import { useChangeNotes } from "@/lib/queries";
import { cn } from "@/lib/utils";

// DATE FORMAT FOR CHANGE NOTES
const noteDate = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

// THE SENTENCE A PERSON CLICKED (section + its offsets; offsets identify it in the body)
export type SelectedSentence = { sectionId: string } & SentenceLink;

type LiveSectionProps = {
  section: Tables<"sections">;
  selected: SelectedSentence | null;
  onSelect: (sentence: SelectedSentence) => void;
};

// LIVE SECTION: title, cited sentences, a gold bar while stale or rebuilding, and the latest change note
export function LiveSection({ section, selected, onSelect }: LiveSectionProps) {
  const isStale = section.status !== "current";
  const links = section.sentence_links as SentenceLink[];
  const spans = splitBody(section.body, links);
  return (
    <section aria-busy={section.status === "building"} className={cn("flex flex-col gap-2 border-l-2 pl-3", isStale ? "border-stale" : "border-transparent")}>
      <h2 className="border-b pb-1 text-body font-semibold">{section.title}</h2>
      {spans.length === 0 ? (
        <p className="text-body text-faint">{isStale ? "Not built yet." : "Nothing known yet."}</p>
      ) : (
        <p className="text-body">
          {spans.map((span) => (
            <SentenceSpan key={span.start} span={span} sectionId={section.id} selected={selected} onSelect={onSelect} />
          ))}
        </p>
      )}
      <LatestChangeNote sectionId={section.id} />
    </section>
  );
}

type SentenceSpanProps = { span: BodySpan; sectionId: string; selected: SelectedSentence | null; onSelect: (s: SelectedSentence) => void };

// ONE SENTENCE: clickable when it cites units; highlighted while selected
function SentenceSpan({ span, sectionId, selected, onSelect }: SentenceSpanProps) {
  const { link } = span;
  if (!link) return <>{span.text}</>;
  const isSelected = selected?.sectionId === sectionId && selected.start === link.start && selected.end === link.end;
  const select = () => onSelect({ sectionId, ...link });
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select();
    }
  };
  return (
    <span
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={select}
      onKeyDown={onKeyDown}
      className={cn("cursor-pointer rounded-sm hover:bg-hover", isSelected && "bg-hover")}
    >
      {span.text}
    </span>
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
