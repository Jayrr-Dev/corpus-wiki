import type { DraftAction } from "./types";

export type UnitReference = { label: string; unitId: string; revisionId: string; content: string; kind: string; epistemicStatus: string };
type ReferencedUnit = Omit<UnitReference, "label">;

export function splitUnitReferences(text: string): { text: string; label?: string }[] {
  return text.split(/(\bU[1-9]\d*\b)/gi).filter(Boolean).map((text) => ({ text, ...(/^U[1-9]\d*$/i.test(text) ? { label: text.toUpperCase() } : {}) }));
}

// Snapshot the exact batch and revisions the model saw; current unit ordering is unrelated.
export function captureUnitReferences(reason: string, units: readonly ReferencedUnit[]): UnitReference[] {
  const labels = [...new Set(splitUnitReferences(reason).flatMap((part) => part.label ?? []))];
  return labels.flatMap((label) => {
    const unit = units[Number(label.slice(1)) - 1];
    return unit ? [{ label, unitId: unit.unitId, revisionId: unit.revisionId, content: unit.content, kind: unit.kind, epistemicStatus: unit.epistemicStatus }] : [];
  });
}

export function annotateUnitReferences(action: DraftAction, units: readonly ReferencedUnit[]): DraftAction {
  const input = action.input;
  const reason = "rationale" in input ? input.rationale : "reason" in input ? input.reason : "";
  const references = captureUnitReferences(reason ?? "", units);
  return references.length ? { ...action, input: { ...input, rationaleReferences: references } } as DraftAction : action;
}

// Stored action JSON is untrusted, and older proposals have no reference snapshots.
export function readUnitReferences(value: unknown): UnitReference[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is UnitReference => item !== null && typeof item === "object" &&
    ["label", "unitId", "revisionId", "content", "kind", "epistemicStatus"].every((key) => typeof item[key] === "string") && /^U[1-9]\d*$/.test(item.label));
}
