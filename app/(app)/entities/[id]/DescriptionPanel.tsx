"use client";

import { useActorLabel } from "@/app/(app)/_lib/useActorLabel";
import { useServerAction } from "@/components/actions/useServerAction";
import { DialogForm } from "@/components/actions/DialogForm";
import { InlineDiff } from "@/components/diff/DiffView";
import { PanelSection, historyDate } from "@/components/living-page/LinePanel";
import { RowMenu } from "@/components/row-menu/RowMenu";
import { Badge } from "@/components/ui/badge";
import type { Tables } from "@/lib/database/types";
import { useEntityDescriptionRevisions } from "@/lib/queries";
import { restoreEntityDescription } from "@/lib/server-actions/entities";
import { cn } from "@/lib/utils";

type Version = Tables<"entity_description_revisions">;

// DESCRIPTION PANEL (entity page, right side): the description and every earlier version of it,
// newest first, like a page line's history. An older version can be previewed (the page shows it,
// nothing saved) or restored (it becomes the description again, as a new version on top).
type DescriptionPanelProps = { entity: Tables<"entities">; previewId: string | null; onPreview: (version: Version | null) => void };
export function DescriptionPanel({ entity, previewId, onPreview }: DescriptionPanelProps) {
  const { data: versions = [] } = useEntityDescriptionRevisions({ filters: { entity_id: entity.id } });
  const label = useActorLabel();
  // The newest version is the description shown, unless it was cleared since
  const currentId = versions[0]?.description === entity.description ? versions[0].id : null;
  return (
    <div className="flex flex-col">
      <PanelSection title="Description" hint="Written from the claims that mention this entity.">
        {entity.description ? <p className="text-panel">{entity.description}</p> : <p className="text-panel text-faint">No description yet.</p>}
      </PanelSection>
      <PanelSection title="History">
        {versions.length === 0 ? <p className="text-panel text-faint">No earlier versions.</p> : null}
        <ol className="flex flex-col gap-3">
          {versions.map((version, index) => {
            const previous = versions[index + 1];
            const isCurrent = version.id === currentId;
            const isPreviewed = version.id === previewId;
            return (
              <li key={version.id} className={cn("-mx-2 flex flex-col gap-1.5 rounded-md px-2 py-1 text-panel", isPreviewed && "bg-muted")}>
                <div className="flex items-start gap-1">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-1.5">
                      <span className="font-medium">{version.restored_from_id ? "Restored" : previous ? "Rewritten" : "First written"}</span>
                      {isCurrent ? <Badge variant="secondary">Current</Badge> : isPreviewed ? <Badge variant="outline">Previewing</Badge> : null}
                    </span>
                    <span className="text-xs text-faint">
                      {label(version.author, version.author_id, version.model_version)} · {historyDate.format(new Date(version.created_at))}
                    </span>
                  </div>
                  {isCurrent ? null : (
                    <RowMenu
                      label={`version from ${historyDate.format(new Date(version.created_at))}`}
                      items={[
                        isPreviewed ? { label: "Stop preview", run: () => onPreview(null) } : { label: "Preview this version", run: () => onPreview(version) },
                        { label: "Restore this version", separatorBefore: true, isDestructive: true, body: (close) => <RestoreForm version={version} onDone={() => { onPreview(null); close(); }} /> },
                      ]}
                    />
                  )}
                </div>
                {previous ? <InlineDiff before={previous.description} after={version.description} /> : <span>{version.description}</span>}
              </li>
            );
          })}
        </ol>
      </PanelSection>
    </div>
  );
}

// RESTORE: confirms, then saves the older text as the newest version
function RestoreForm({ version, onDone }: { version: Version; onDone: () => void }) {
  const restore = useServerAction(restoreEntityDescription, { progress: false, refreshTables: ["entities", "entity_description_revisions"] });
  return (
    <DialogForm
      title={`Restore the version from ${historyDate.format(new Date(version.created_at))}?`}
      description="The description goes back to this text as a new version; its history is kept. The next upload about this entity may rewrite it."
      submitLabel="Restore"
      isDestructive
      isPending={restore.isPending}
      error={restore.error}
      onSubmit={async () => {
        if ((await restore.run(version.id)).ok) onDone();
      }}
    >
      <p className="whitespace-pre-line rounded-md border p-3 text-panel">{version.description}</p>
    </DialogForm>
  );
}
