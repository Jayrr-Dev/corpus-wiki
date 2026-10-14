"use client";

import { useState } from "react";
import { StatusGlyph } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useRevision, useUnit } from "@/lib/queries";
import { CitationChip } from "./CitationChip";
import { UnitEditor } from "./UnitEditor";

// SENTENCE PANEL: the units behind the clicked sentence, each with its sources
export function SentencePanel({ unitIds }: { unitIds: string[] }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-[11px] font-medium tracking-wide text-faint uppercase">Behind this sentence</h2>
      {unitIds.map((unitId) => (
        <UnitCard key={unitId} unitId={unitId} />
      ))}
    </div>
  );
}

// ONE UNIT: status glyph, current content, citations, and an inline Edit
function UnitCard({ unitId }: { unitId: string }) {
  const [isEditing, setIsEditing] = useState(false);
  const { data: unit } = useUnit(unitId);
  const { data: revision } = useRevision(unit?.current_revision_id);
  if (!unit || !revision) return <p className="text-panel text-faint">Loading…</p>;
  return (
    <article className="flex flex-col gap-2 border-b pb-3 last:border-b-0">
      <div className="flex items-start gap-1.5 text-panel">
        <StatusGlyph status={unit.epistemic_status} className="mt-0.5 shrink-0 text-muted-foreground" />
        {isEditing ? null : <p className="flex-1">{revision.content}</p>}
      </div>
      {isEditing ? (
        <UnitEditor unitId={unit.id} revisionId={revision.id} content={revision.content} onDone={() => setIsEditing(false)} />
      ) : (
        <Button type="button" size="sm" variant="ghost" className="self-start" onClick={() => setIsEditing(true)}>
          Edit
        </Button>
      )}
      {revision.passage_ids.map((passageId) => (
        <CitationChip key={passageId} passageId={passageId} />
      ))}
    </article>
  );
}
