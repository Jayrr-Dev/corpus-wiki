"use client";

import { type ReactNode, useState } from "react";
import { useActorLabel } from "@/app/(app)/_lib/useActorLabel";
import { useNoteActor } from "./NoteByline";
import { StatusGlyph } from "@/components/icons";
import { InlineDiff } from "@/components/diff/DiffView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type ShownLine, useChangeNotes, useLineRevisions, useRevision, useUnit } from "@/lib/queries";
import { useServerAction } from "@/components/actions/useServerAction";
import { submitEdit, submitLineEdit } from "@/lib/server-actions/knowledge";
import { removeLine } from "@/lib/server-actions/pages";
import { RowMenu } from "@/components/row-menu/RowMenu";
import { cn } from "@/lib/utils";
import { DialogForm } from "@/components/actions/DialogForm";
import { CitationChip } from "./CitationChip";
import type { LinePreview } from "./LiveSection";
import { TextEditor } from "./TextEditor";
import { Loader } from "@/components/standard/loader";

// DATE FORMAT FOR LINE AND SECTION HISTORY
export const historyDate = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

// Tables a saved edit changes that have no Realtime feed
export const EDIT_REFRESHES = ["units", "revisions", "line_revisions"] as const;

// LINE PANEL: the clicked line (editable), the claims it states with their sources, and its history
type LinePanelProps = { line: ShownLine; preview: LinePreview | null; onPreview: (preview: LinePreview | null) => void; isEditing: boolean; onEdit: () => void };
export function LinePanel({ line, preview, onPreview, isEditing, onEdit }: LinePanelProps) {
  return (
    <div className="flex flex-col">
      <LineSection line={line} isEditing={isEditing} onEdit={onEdit} />
      <PanelSection title="Knowledge applied">
        {line.unitRevisionIds.length === 0 ? <p className="text-panel text-faint">Source needed: this line cites no claim.</p> : null}
        {line.unitRevisionIds.map((revisionId) => (
          <ClaimCard key={revisionId} citedRevisionId={revisionId} />
        ))}
      </PanelSection>
      <PanelSection title="History">
        <LineHistory lineId={line.lineId} currentRevisionId={line.lineRevisionId} preview={preview} onPreview={onPreview} />
      </PanelSection>
      <SectionChanges sectionId={line.sectionId} />
    </div>
  );
}

// ONE PANEL SECTION: a ruled-off block with a small uppercase heading and optional header buttons
export function PanelSection({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t py-4 first:border-t-0 first:pt-0">
      <header className="flex min-h-7 items-center justify-between gap-2">
        <h2 className="text-panel font-medium tracking-wide text-faint uppercase">{title}</h2>
        {actions ? <div className="flex gap-1.5">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

// THE LINE ITSELF: its text, with Edit (rewrites the paragraph in place on the page) and Remove in the header
function LineSection({ line, isEditing, onEdit }: { line: ShownLine; isEditing: boolean; onEdit: () => void }) {
  // Remove retires the line (undo on the Changes screen brings it back); the claims stay
  const remove = useServerAction(removeLine, { progress: { title: "Removing line", detail: "Rewriting the section…", delayMs: 800 } });
  const actions = isEditing ? null : (
    <>
      <Button type="button" size="xs" variant="outline" onClick={onEdit}>
        Edit
      </Button>
      <Button type="button" size="xs" variant="outline" disabled={remove.isPending} onClick={() => void remove.run(line.lineId, line.lineRevisionId)}>
        {remove.isPending ? "Removing…" : "Remove"}
      </Button>
    </>
  );
  return (
    <PanelSection title="This line" actions={actions}>
      <p className="whitespace-pre-line text-panel">{line.content}</p>
      {remove.error ? <p className="text-panel text-failed">{remove.error}</p> : null}
    </PanelSection>
  );
}

// ONE CLAIM THE LINE CITES: status, current text (and the cited text when it changed), sources, Edit
function ClaimCard({ citedRevisionId }: { citedRevisionId: string }) {
  const [isEditing, setIsEditing] = useState(false);
  const { data: cited } = useRevision(citedRevisionId);
  const { data: unit } = useUnit(cited?.unit_id);
  const { data: current } = useRevision(unit?.current_revision_id);
  if (!cited || !unit || !current) return <Loader inline />;
  const hasChanged = current.id !== cited.id || unit.retired_at !== null;
  return (
    <article className="flex flex-col rounded-lg border">
      <header className="flex min-h-10 items-center gap-1.5 border-b px-3 py-1.5 text-panel">
        <StatusGlyph status={unit.epistemic_status} className="shrink-0 text-muted-foreground" />
        <h3 className="flex-1 font-medium">
          Claim · <span className="text-faint capitalize">{unit.epistemic_status}</span>
        </h3>
        {isEditing ? null : (
          <Button type="button" size="xs" variant="outline" onClick={() => setIsEditing(true)}>
            Edit
          </Button>
        )}
      </header>
      {/* A long claim with many sources scrolls inside the card so the rest of the panel stays in reach */}
      <div className="flex max-h-96 flex-col gap-2 overflow-y-auto p-3">
        {isEditing ? null : <p className="text-panel">{current.content}</p>}
        {hasChanged ? <p className="text-panel text-stale">Changed since this line was written: “{cited.content}”</p> : null}
        {isEditing ? (
          <TextEditor
            content={current.content}
            label="Claim"
            onSave={(text) => submitEdit({ type: "revise_claim", targetId: unit.id, expectedRevisionId: current.id, input: { content: text }, passageIds: [], speechAct: null })}
            onDone={() => setIsEditing(false)}
            refreshTables={[...EDIT_REFRESHES]}
          />
        ) : null}
        {current.passage_ids.map((passageId) => (
          <CitationChip key={passageId} passageId={passageId} />
        ))}
      </div>
    </article>
  );
}

// EVERY VERSION OF THE LINE, newest first: what each one changed from the one before, and who wrote it.
// An older version's "…" menu can Preview it (the page shows it, nothing saved) or Restore it
// (after confirming, the line is rewritten to that text as a new edit on top, which the AI can still contest).
type LineVersion = { id: string; content: string; created_at: string };
type LineHistoryProps = { lineId: string; currentRevisionId: string; preview: LinePreview | null; onPreview: (preview: LinePreview | null) => void };
function LineHistory({ lineId, currentRevisionId, preview, onPreview }: LineHistoryProps) {
  const { data: revisions = [] } = useLineRevisions({ filters: { line_id: lineId } });
  const label = useActorLabel();
  return (
    <ol className="flex flex-col gap-3 whitespace-pre-line">
      {revisions.map((revision, index) => {
        const previous = revisions[index + 1];
        const isCurrent = revision.id === currentRevisionId;
        const isPreviewed = revision.id === preview?.revisionId;
        return (
          <li key={revision.id} className={cn("-mx-2 flex flex-col gap-1.5 rounded-md px-2 py-1 text-panel", isPreviewed && "bg-muted")}>
            {/* Header: what happened (with Current/Previewing) on top, who and when below, the menu to the right */}
            <div className="flex items-start gap-1 whitespace-normal">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-1.5">
                  <span className="font-medium">{previous ? "Edited" : "First written"}</span>
                  {isCurrent ? <Badge variant="secondary">Current</Badge> : isPreviewed ? <Badge variant="outline">Previewing</Badge> : null}
                </span>
                <span className="text-xs text-faint">
                  {label(revision.author, revision.author_id, revision.model_version)} · {historyDate.format(new Date(revision.created_at))}
                </span>
              </div>
              {isCurrent ? null : (
                <RowMenu
                  label={`version from ${historyDate.format(new Date(revision.created_at))}`}
                  items={[
                    isPreviewed
                      ? { label: "Stop preview", run: () => onPreview(null) }
                      : { label: "Preview this version", run: () => onPreview({ lineId, revisionId: revision.id, content: revision.content, createdAt: revision.created_at }) },
                    { label: "Restore this version", separatorBefore: true, isDestructive: true, body: (close) => <RestoreForm lineId={lineId} version={revision} onDone={() => { onPreview(null); close(); }} /> },
                  ]}
                />
              )}
            </div>
            {previous ? <InlineDiff before={previous.content} after={revision.content} /> : <span>{revision.content}</span>}
          </li>
        );
      })}
    </ol>
  );
}

// RESTORE: confirms, then saves the older text as the line's newest version
function RestoreForm({ lineId, version, onDone }: { lineId: string; version: LineVersion; onDone: () => void }) {
  const restore = useServerAction(submitLineEdit, { progress: { title: "Restoring version", detail: "Rewriting the section…", delayMs: 800 } });
  return (
    <DialogForm
      title={`Restore the version from ${historyDate.format(new Date(version.created_at))}?`}
      description="The line goes back to this text as a new edit on top of its history. Earlier versions stay in History, and the AI can still contest the restored text."
      submitLabel="Restore"
      isDestructive
      isPending={restore.isPending}
      error={restore.error}
      onSubmit={async () => {
        if ((await restore.run(lineId, version.content)).ok) onDone();
      }}
    >
      <p className="whitespace-pre-line rounded-md border p-3 text-panel">{version.content}</p>
    </DialogForm>
  );
}

// ONE SECTION CHANGE: summary, then when and who made it
function SectionChangeItem({ note }: { note: { event_id: string; summary: string; created_at: string } }) {
  const actor = useNoteActor(note.event_id);
  return (
    <li className="flex flex-col text-panel">
      <span>{note.summary}</span>
      <span className="text-faint">{historyDate.format(new Date(note.created_at))}{actor.label ? ` · ${actor.label}` : null}</span>
    </li>
  );
}

// RECENT CHANGES TO THE SECTION this line sits in, newest first
function SectionChanges({ sectionId }: { sectionId: string }) {
  const { data: notes = [] } = useChangeNotes({ filters: { section_id: sectionId }, limit: 3 });
  if (!notes.length) return null;
  return (
    <PanelSection title="Section changes">
      <ol className="flex flex-col gap-2">
        {notes.map((note) => (
          <SectionChangeItem key={note.id} note={note} />
        ))}
      </ol>
    </PanelSection>
  );
}
