"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { Tables } from "@/lib/database/types";
import { useActorLabel } from "@/app/(app)/_lib/useActorLabel";
import { type ShownLine, useChangeNotes } from "@/lib/queries";
import { blockSummary } from "@/lib/living-page/blocks";
import { cn } from "@/lib/utils";
import { historyDate, PanelSection } from "./LinePanel";
import { useNoteActor } from "./NoteByline";
import { Loader } from "@/components/standard/loader";

// The section's latest edit: its newest line change, or when it was last built
export function sectionUpdatedAt(section: Tables<"sections">, lines: ShownLine[]): string | null {
  const times = [section.built_at, ...lines.map((line) => line.lastChangedAt)].filter((time): time is string => Boolean(time));
  return times.length ? times.reduce((latest, time) => (time > latest ? time : latest)) : null;
}

// SECTION PANEL: the clicked section title (with its Update / Rename / Remove menu), its lines, and every change to it
export function SectionPanel({ section, lines, menu, onSelectLine }: { section: Tables<"sections">; lines: ShownLine[]; menu: ReactNode; onSelectLine: (line: ShownLine) => void }) {
  const updatedAt = sectionUpdatedAt(section, lines);
  const label = useActorLabel();
  return (
    <div className="flex flex-col">
      <PanelSection title="This section" actions={menu}>
        <p className="text-panel font-medium">{section.title}</p>
        <p className="text-panel text-faint">
          {lines.length} {lines.length === 1 ? "line" : "lines"}
          {updatedAt ? ` · Updated ${historyDate.format(new Date(updatedAt))}` : null}
        </p>
      </PanelSection>
      <PanelSection title="Lines">
        {lines.length === 0 ? <p className="text-panel text-faint">No lines yet.</p> : null}
        <ol className="flex flex-col gap-1">
          {lines.map((line) => (
            <li key={line.lineId}>
              <button type="button" onClick={() => onSelectLine(line)} className="-mx-2 flex w-full flex-col gap-0.5 rounded-md px-2 py-1 text-left text-panel hover:bg-hover">
                <span className={cn("line-clamp-2", line.isStale && "text-faint")}>{blockSummary(line.content)}</span>
                {line.lastChangedAt ? <span className="text-faint">Updated {historyDate.format(new Date(line.lastChangedAt))} · {label(line.author, line.authorId, line.model)}</span> : null}
              </button>
            </li>
          ))}
        </ol>
      </PanelSection>
      <PanelSection title="History">
        <SectionHistory sectionId={section.id} />
      </PanelSection>
    </div>
  );
}

// EVERY CHANGE TO THE SECTION, newest first; each opens its change set, where it can be undone
function SectionHistory({ sectionId }: { sectionId: string }) {
  const { data: notes = [], isPending } = useChangeNotes({ filters: { section_id: sectionId }, limit: 50 });
  if (isPending) return <Loader inline />;
  if (!notes.length) return <p className="text-panel text-faint">No changes recorded yet.</p>;
  return (
    <ol className="flex flex-col gap-3">
      {notes.map((note) => (
        <SectionChange key={note.id} note={note} />
      ))}
    </ol>
  );
}

// ONE CHANGE NOTE: its summary, date and who made it, linked to the change set that made it
function SectionChange({ note }: { note: Tables<"change_notes"> }) {
  const actor = useNoteActor(note.event_id);
  return (
    <li className="flex flex-col gap-0.5 text-panel">
      <span>{note.summary}</span>
      <span className="text-faint">
        {historyDate.format(new Date(note.created_at))}
        {actor.label ? ` · ${actor.label}` : null}
        {actor.changeSetId ? (
          <>
            {" · "}
            <Link href={`/changes/${actor.changeSetId}`} className="text-link hover:underline">Open change</Link>
          </>
        ) : null}
      </span>
    </li>
  );
}
