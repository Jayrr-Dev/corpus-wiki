"use client";

import { Note, QueryState } from "@/app/(app)/_components/bits";
import { formatDate, humanize } from "@/app/(app)/_lib/format";
import { UnitActionButtons } from "@/components/actions/ActionDialog";
import { StatusGlyph } from "@/components/icons";
import { type UnitSummary, useUnitSummaries } from "@/lib/queries/screens";
import { UnitAbout } from "./UnitAbout";
import { UnitHistory } from "./UnitHistory";
import { UnitLinks } from "./UnitLinks";
import { UnitSources } from "./UnitSources";

// UNIT DETAIL: header and edits, then history, sources, what it is about, and links
export function UnitDetail({ unitId }: { unitId: string }) {
  const query = useUnitSummaries([unitId]);
  const unit = query.data?.[0];
  return (
    <QueryState query={query}>
      {unit ? (
        <div className="flex flex-col gap-6">
          <UnitHeader unit={unit} />
          <UnitHistory unitId={unit.id} />
          <UnitSources unitId={unit.id} />
          <UnitAbout unitId={unit.id} />
          <UnitLinks unitId={unit.id} />
        </div>
      ) : (
        <Note>No unit with this id.</Note>
      )}
    </QueryState>
  );
}

// HEADER: kind and status line, the current content, and the edit buttons
function UnitHeader({ unit }: { unit: UnitSummary }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap items-center gap-2 text-panel text-muted-foreground">
        <StatusGlyph status={unit.epistemic_status} />
        <span>{humanize(unit.epistemic_status)}</span>
        <span className="text-faint">·</span>
        <span>{unit.kind}</span>
        <span className="text-faint">·</span>
        <span className="font-mono">valid from {formatDate(unit.valid_from)}</span>
        {unit.retired_at ? <span className="font-mono text-faint">retired {formatDate(unit.retired_at)}</span> : null}
      </p>
      <p className="text-body">{unit.content}</p>
      <UnitActionButtons unit={unit} />
    </div>
  );
}
