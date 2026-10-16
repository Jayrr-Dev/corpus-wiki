"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useActorLabel } from "@/app/(app)/_lib/useActorLabel";
import { ClaimCard, historyDate, PanelSection } from "@/components/living-page/LinePanel";
import { TextEditor } from "@/components/living-page";
import { InlineDiff } from "@/components/diff/DiffView";
import { DialogForm } from "@/components/actions/DialogForm";
import { useServerAction } from "@/components/actions/useServerAction";
import { RowMenu } from "@/components/row-menu/RowMenu";
import { Loader } from "@/components/standard/loader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { glossaryEntryKey, glossarySentenceCase, type GlossaryEntry } from "@/lib/glossary/entries";
import { changeGlossaryDefinition, glossaryDefinitionHistory, type GlossaryDefinitionVersion } from "@/lib/server-actions/glossary";
import { cn } from "@/lib/utils";

export type DefinitionPreview = { key: string; versionId: string; definition: string };
type DefinitionPanelProps = { entry: GlossaryEntry; queryKey: readonly unknown[]; preview: DefinitionPreview | null; onPreview: (preview: DefinitionPreview | null) => void; onRemoved: () => void };

// DEFINITION PANEL: the clicked definition (editable), the claims it rests on, and its history
export function DefinitionPanel({ entry, queryKey, preview, onPreview, onRemoved }: DefinitionPanelProps) {
  const history = useQuery({
    queryKey: ["glossary", "history", glossaryEntryKey(entry), entry.definition],
    queryFn: async () => {
      const result = await glossaryDefinitionHistory({ term: entry.term, expansion: entry.expansion, scopeKey: entry.scopeKey });
      if (!result.ok) throw new Error(result.error);
      return result.versions;
    },
  });
  const revisionIds = [...new Set(entry.citations.map((cite) => cite.revisionId))];
  return (
    <div className="flex flex-col">
      <DefinitionSection entry={entry} queryKey={queryKey} onRemoved={onRemoved} />
      <PanelSection title="Knowledge applied">
        {revisionIds.length === 0 ? <p className="text-panel text-faint">Source needed: this definition cites no claim.</p> : null}
        {revisionIds.map((revisionId) => <ClaimCard key={revisionId} citedRevisionId={revisionId} />)}
      </PanelSection>
      <PanelSection title="History">
        {history.isPending ? <Loader inline /> : null}
        {history.error ? <p role="alert" className="text-panel text-failed">{history.error.message}</p> : null}
        {history.data ? <DefinitionHistory entry={entry} versions={history.data} queryKey={queryKey} preview={preview} onPreview={onPreview} /> : null}
      </PanelSection>
    </div>
  );
}

// THE DEFINITION ITSELF: its text, with Edit (in place, in the panel) and Remove in the header
function DefinitionSection({ entry, queryKey, onRemoved }: { entry: GlossaryEntry; queryKey: readonly unknown[]; onRemoved: () => void }) {
  const client = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const remove = useServerAction(changeGlossaryDefinition);
  const actions = isEditing ? null : (
    <>
      <Button type="button" size="xs" variant="outline" onClick={() => setIsEditing(true)}>Edit</Button>
      <Button type="button" size="xs" variant="outline" disabled={remove.isPending} onClick={async () => {
        if (!(await remove.run(entry, null)).ok) return;
        await client.invalidateQueries({ queryKey });
        onRemoved();
      }}>{remove.isPending ? "Removing…" : "Remove"}</Button>
    </>
  );
  return (
    <PanelSection title="This definition" actions={actions} closable>
      <p className="text-panel font-medium">{glossarySentenceCase(entry.term)}</p>
      {isEditing ? (
        <TextEditor
          content={entry.definition}
          label="Definition"
          onSave={async (text) => {
            const result = await changeGlossaryDefinition(entry, text);
            if (result.ok) await client.invalidateQueries({ queryKey });
            return result;
          }}
          onDone={() => setIsEditing(false)}
        />
      ) : <p className="whitespace-pre-line text-panel">{entry.definition}</p>}
      {remove.error ? <p className="text-panel text-failed">{remove.error}</p> : null}
    </PanelSection>
  );
}

// EVERY VERSION OF THE DEFINITION, newest first: what each one changed from the one before, and who wrote it.
// An older version's "…" menu can Preview it (the glossary shows it, nothing saved) or Restore it
// (after confirming, the definition is rewritten to that text as a new edit on top).
type DefinitionHistoryProps = { entry: GlossaryEntry; versions: GlossaryDefinitionVersion[]; queryKey: readonly unknown[]; preview: DefinitionPreview | null; onPreview: (preview: DefinitionPreview | null) => void };
function DefinitionHistory({ entry, versions, queryKey, preview, onPreview }: DefinitionHistoryProps) {
  const label = useActorLabel();
  const key = glossaryEntryKey(entry);
  if (!versions.length) return <p className="text-panel text-faint">No earlier versions recorded.</p>;
  return (
    <ol className="flex flex-col gap-3 whitespace-pre-line">
      {versions.map((version, index) => {
        const previous = versions[index + 1];
        const isCurrent = index === 0 && version.definition === entry.definition;
        const isPreviewed = version.id === preview?.versionId;
        const when = historyDate.format(new Date(version.createdAt));
        return (
          <li key={version.id} className={cn("-mx-2 flex flex-col gap-1.5 rounded-md px-2 py-1 text-panel", isPreviewed && "bg-muted")}>
            <div className="flex items-start gap-1 whitespace-normal">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-1.5">
                  <span className="font-medium">{previous ? "Edited" : "First written"}</span>
                  {isCurrent ? <Badge variant="secondary">Current</Badge> : isPreviewed ? <Badge variant="outline">Previewing</Badge> : null}
                </span>
                <span className="text-xs text-faint">{label(version.actor, version.authorId, version.model)} · {when}</span>
              </div>
              {isCurrent || version.definition === entry.definition ? null : (
                <RowMenu
                  label={`version from ${when}`}
                  items={[
                    isPreviewed
                      ? { label: "Stop preview", run: () => onPreview(null) }
                      : { label: "Preview this version", run: () => onPreview({ key, versionId: version.id, definition: version.definition }) },
                    { label: "Restore this version", separatorBefore: true, isDestructive: true, body: (close) => <RestoreForm entry={entry} version={version} queryKey={queryKey} onDone={() => { onPreview(null); close(); }} /> },
                  ]}
                />
              )}
            </div>
            {previous ? <InlineDiff before={previous.definition} after={version.definition} /> : <span>{version.definition}</span>}
          </li>
        );
      })}
    </ol>
  );
}

// RESTORE: confirms, then saves the older text as the definition's newest version
function RestoreForm({ entry, version, queryKey, onDone }: { entry: GlossaryEntry; version: GlossaryDefinitionVersion; queryKey: readonly unknown[]; onDone: () => void }) {
  const client = useQueryClient();
  const restore = useServerAction(changeGlossaryDefinition);
  return (
    <DialogForm
      title={`Restore the version from ${historyDate.format(new Date(version.createdAt))}?`}
      description="The definition goes back to this text as a new edit on top of its history. Earlier versions stay in History. Regenerating the glossary may replace it."
      submitLabel="Restore"
      isDestructive
      isPending={restore.isPending}
      error={restore.error}
      onSubmit={async () => {
        if (!(await restore.run(entry, version.definition)).ok) return;
        await client.invalidateQueries({ queryKey });
        onDone();
      }}
    >
      <p className="whitespace-pre-line rounded-md border p-3 text-panel">{version.definition}</p>
    </DialogForm>
  );
}
