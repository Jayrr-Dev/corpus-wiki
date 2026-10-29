"use client";

import { useId } from "react";
import { type Coverage, COVERAGES } from "@/lib/knowledge/scopeTypes";

// COVERAGE PICKER: the share of a scope's claims a module uses (25%, 50% or 100%), on one row.
// Below 100%, the most-cited claims come first (pickCoverage in lib/knowledge/scope.ts).
export function CoveragePicker({ value, onChange, disabled }: { value: Coverage; onChange: (coverage: Coverage) => void; disabled?: boolean }) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label="Coverage" className="flex flex-wrap gap-x-5 gap-y-2">
      {COVERAGES.map((coverage) => (
        <label key={coverage} className="flex items-center gap-2 text-panel">
          <input type="radio" name={name} className="accent-link" checked={value === coverage} disabled={disabled} onChange={() => onChange(coverage)} />
          <span className="font-medium">{coverage}%</span>
        </label>
      ))}
    </div>
  );
}
