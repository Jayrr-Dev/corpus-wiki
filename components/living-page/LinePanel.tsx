"use client";

import { useState } from "react";
import { StatusGlyph } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { type ShownLine, useLineRevisions, useRevision, useUnit } from "@/lib/queries";
import { useServerAction } from "@/components/actions/useServerAction";
import { submitEdit, submitLineEdit } from "@/lib/server-actions/knowledge";
import { removeLine } from "@/lib/server-actions/pages";
import { CitationChip } from "./CitationChip";
import { TextEditor } from "./TextEditor";

// DATE FORMAT FOR LINE HISTORY
const historyDate = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

// Tables a saved edit changes that have no Realtime feed
const EDIT_REFRESHES = ["units", "revisions", "line_revisions"] as const;

// LINE PANEL: the clicked line (editable), the claims it states with their sources, and its history
export function LinePanel({ line }: { line: ShownLine }) {
  return (
    <div className="flex flex-col gap-4">
      <PanelHeading>This line</PanelHeading>
      <LineCard line={line} />
      <PanelHeading>Behind this line</PanelHeading>
      {line.unitRevisionIds.length === 0 ? <p className="text-panel text-faint">Source needed: this line cites no claim.</p> : null}
      {line.unitRevisionIds.map((revisionId) => (
        <ClaimCard key={revisionId} citedRevisionId={revisionId} />
      ))}
      <PanelHeading>History</PanelHeading>
      <LineHistory lineId={line.lineId} />
    </div>
  );
}

// SMALL UPPERCASE HEADING
function PanelHeading({ children }: { children: string }) {
  return <h2 className="text-panel font-medium tracking-wide text-faint uppercase">{children}</h2>;
}

// THE LINE ITSELF: its text, an inline Edit (a one-claim line also revises its claim) and Remove
function LineCard({ line }: { line: ShownLine }) {
  const [isEditing, setIsEditing] = useState(false);
  if (isEditing) {
    return (
      <TextEditor
        content={line.content}
        label="Line"
        onSave={(text) => submitLineEdit(line.lineId, text)}
        onDone={() => setIsEditing(false)}
        refreshTables={[...EDIT_REFRESHES]}
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-panel">{line.content}</p>
      <div className="flex gap-1">
        <Button type="button" size="sm" variant="ghost" onClick={() => setIsEditing(true)}>
          Edit line
        </Button>
        <RemoveLineButton line={line} />
      </div>
    </div>
  );
}

// REMOVE LINE: retires it (undo on the Changes screen brings it back); the claims stay
function RemoveLineButton({ line }: { line: ShownLine }) {
  const remove = useServerAction(removeLine);
  return (
    <>
      <Button type="button" size="sm" variant="ghost" disabled={remove.isPending} onClick={() => void remove.run(line.lineId, line.lineRevisionId)}>
        {remove.isPending ? "Removing…" : "Remove line"}
      </Button>
      {remove.error ? <p className="text-panel text-failed">{remove.error}</p> : null}
    </>
  );
}

// ONE CLAIM THE LINE CITES: status, current text (and the cited text when it changed), sources, Edit
function ClaimCard({ citedRevisionId }: { citedRevisionId: string }) {
  const [isEditing, setIsEditing] = useState(false);
  const { data: cited } = useRevision(citedRevisionId);
  const { data: unit } = useUnit(cited?.unit_id);
  const { data: current } = useRevision(unit?.current_revision_id);
  if (!cited || !unit || !current) return <p className="text-panel text-faint">Loading…</p>;
  const hasChanged = current.id !== cited.id || unit.retired_at !== null;
  return (
    <article className="flex flex-col gap-2 border-b pb-3 last:border-b-0">
      <div className="flex items-start gap-1.5 text-panel">
        <StatusGlyph status={unit.epistemic_status} className="mt-0.5 shrink-0 text-muted-foreground" />
        {isEditing ? null : <p className="flex-1">{current.content}</p>}
      </div>
      {hasChanged ? <p className="text-panel text-stale">Changed since this line was written: “{cited.content}”</p> : null}
      {isEditing ? (
        <TextEditor
          content={current.content}
          label="Claim"
          onSave={(text) => submitEdit({ type: "revise_claim", targetId: unit.id, expectedRevisionId: current.id, input: { content: text }, passageIds: [], speechAct: null })}
          onDone={() => setIsEditing(false)}
          refreshTables={[...EDIT_REFRESHES]}
        />
      ) : (
        <Button type="button" size="sm" variant="ghost" className="self-start" onClick={() => setIsEditing(true)}>
          Edit claim
        </Button>
      )}
      {current.passage_ids.map((passageId) => (
        <CitationChip key={passageId} passageId={passageId} />
      ))}
    </article>
  );
}

// EVERY VERSION OF THE LINE, newest first, with who wrote it
function LineHistory({ lineId }: { lineId: string }) {
  const { data: revisions = [] } = useLineRevisions({ filters: { line_id: lineId } });
  return (
    <ol className="flex flex-col gap-2">
      {revisions.map((revision) => (
        <li key={revision.id} className="flex flex-col text-panel">
          <span>{revision.content}</span>
          <span className="text-faint">
            {revision.author === "ai" ? `AI (${revision.model_version ?? "model"})` : "Person"} · {historyDate.format(new Date(revision.created_at))}
          </span>
        </li>
      ))}
    </ol>
  );
}
