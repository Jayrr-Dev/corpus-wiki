"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { Tables } from "@/lib/database/types";
import { type ShownLine, useChangeNotes } from "@/lib/queries";
import { formatReferencePages, linkArticleText, type ArticleEvidence, type ArticleLink } from "@/lib/living-page/articleEvidence";
import { cn } from "@/lib/utils";

const noteDate = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

type LiveSectionProps = {
  section: Tables<"sections">;
  lines: ShownLine[];
  selectedLineId: string | null;
  onSelect: (line: ShownLine) => void;
  menu?: ReactNode;
  evidence?: ArticleEvidence;
  links?: ArticleLink[];
  hideHeading?: boolean;
};

// Each stored line is a real paragraph, with source refs and links outside the evidence button.
export function LiveSection({ section, lines, selectedLineId, onSelect, menu, evidence, links = [], hideHeading = false }: LiveSectionProps) {
  const isStale = section.status !== "current";
  return (
    <section id={`section-${section.id}`} aria-label={section.title} aria-busy={section.status === "building"} className={cn("scroll-mt-6", isStale && "relative pl-3")}>
      {isStale ? <span aria-hidden="true" className="sb-stale-line" /> : null}
      {!hideHeading ? (
        <header className="group mb-4 flex items-center justify-between gap-2 border-b pb-2">
          <h2 className="font-serif text-2xl">{section.title}</h2>
          {menu}
        </header>
      ) : null}
      {lines.length === 0 ? (
        <p className="text-body text-faint">{isStale ? "Writing this section…" : "Nothing known yet."}</p>
      ) : (
        <div className="space-y-4">
          {lines.map((line) => {
            const references = evidence?.byLine.get(line.lineId) ?? [];
            return (
              <p key={line.lineId} id={`line-${line.lineId}`} className={cn("group/paragraph text-body leading-7", line.lineId === selectedLineId && "rounded-sm bg-hover", line.isStale && "text-faint")}>
                {linkArticleText(line.content, links).map((chunk, index) => chunk.href ? (
                  <Link key={index} href={chunk.href} className="text-link hover:underline">{chunk.text}</Link>
                ) : <span key={index}>{chunk.text}</span>)}
                {references.map((reference) => {
                  return <sup key={reference.number} className="ml-0.5 text-xs"><a id={reference.anchorId} href={`#reference-${reference.number}`} title={`${reference.title}${reference.citedPages.length ? `, pages ${formatReferencePages(reference.citedPages)}` : ""}`} aria-label={`Source ${reference.number}: ${reference.title}`} className="text-link hover:underline">[{reference.number}]</a></sup>;
                })}
                {!references.length && evidence ? <span className="ml-1 text-xs text-faint">[source needed]</span> : null}
                <button type="button" onClick={() => onSelect(line)} aria-label="View evidence and edit this paragraph" className="ml-2 text-xs text-faint opacity-0 transition-opacity group-hover/paragraph:opacity-100 focus-visible:opacity-100 hover:text-link">{line.lastChangedAt ? `Updated ${noteDate.format(new Date(line.lastChangedAt))}` : "details"}</button>
              </p>
            );
          })}
        </div>
      )}
      <LatestChangeNote sectionId={section.id} />
    </section>
  );
}

function LatestChangeNote({ sectionId }: { sectionId: string }) {
  const { data: notes = [] } = useChangeNotes({ filters: { section_id: sectionId }, limit: 1 });
  const note = notes[0];
  if (!note) return null;
  return <p className="mt-3 text-xs text-faint">{note.summary} · {noteDate.format(new Date(note.created_at))}</p>;
}
