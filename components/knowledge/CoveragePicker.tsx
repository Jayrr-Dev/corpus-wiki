"use client";

import { useId, useState } from "react";
import { ClaimPickDialog } from "@/components/knowledge/ClaimPickDialog";
import { type CoverageChoice, COVERAGES, isCustomChoice, type Scope } from "@/lib/knowledge/scopeTypes";

// COVERAGE PICKER: the share of a scope's claims a module uses (25%, 50% or 100%), or Custom: the claims
// the person checks in a dialog (ClaimPickDialog). Below 100%, the most-cited claims come first (pickCoverage
// in lib/knowledge/scope.ts). Custom needs a source (`scope`) to list its claims.
export function CoveragePicker({ value, onChange, scope, disabled, allowCustom = true }: {
  value: CoverageChoice;
  onChange: (choice: CoverageChoice) => void;
  scope: Scope | null;
  disabled?: boolean;
  allowCustom?: boolean;
}) {
  const name = useId();
  const [editing, setEditing] = useState(false);
  const custom = isCustomChoice(value) ? value.custom : null;
  return (
    <div role="radiogroup" aria-label="Coverage" className="flex flex-wrap gap-x-5 gap-y-2">
      {COVERAGES.map((coverage) => (
        <label key={coverage} className="flex items-center gap-2 text-panel">
          <input type="radio" name={name} className="accent-link" checked={value === coverage} disabled={disabled} onChange={() => onChange(coverage)} />
          <span className="font-medium">{coverage}%</span>
        </label>
      ))}
      {allowCustom ? (
        <label className="flex items-center gap-2 text-panel">
          {/* onClick, not onChange: a Custom pick that is already checked still opens the dialog to edit */}
          <input type="radio" name={name} className="accent-link" checked={custom !== null} disabled={disabled || !scope} onClick={() => setEditing(true)} onChange={() => {}} />
          <span className="font-medium">Custom{custom ? ` (${custom.length})` : ""}</span>
        </label>
      ) : null}
      {allowCustom && scope ? <ClaimPickDialog open={editing} onOpenChange={setEditing} scope={scope} picked={custom ?? []} onSave={(unitIds) => onChange({ custom: unitIds })} /> : null}
    </div>
  );
}
