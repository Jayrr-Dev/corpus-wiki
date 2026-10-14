import type { EpistemicStatus, RelationshipType } from "@/lib/ai/types";
import type { PersonAction } from "@/lib/change-control/types";

// =====================================================================
// ACTION BUILDER: turns the ActionDialog's form values into the one typed
// action Change control receives. Pure, so the shapes are unit-tested.
// =====================================================================

// THE FOUR EDITS A UNIT PAGE OFFERS
export type ActionMode = "revise" | "retire" | "link" | "set_status";

// FORM VALUES (one bag for every mode; each mode reads its own fields)
export type ActionFormValues = {
  content: string;
  epistemicStatus: EpistemicStatus | "";
  reason: string;
  toUnitId: string;
  relationshipType: RelationshipType;
};

// THE UNIT BEING EDITED (what the person saw when they opened the dialog)
export type ActionTarget = { id: string; currentRevisionId: string; content: string; epistemicStatus: EpistemicStatus };

// Starting values: the unit's own content and status
export function initialValues(target: ActionTarget): ActionFormValues {
  return { content: target.content, epistemicStatus: "", reason: "", toUnitId: "", relationshipType: "related_to" };
}

// Why the form cannot be sent yet, or null when it can
export function validateValues(mode: ActionMode, target: ActionTarget, values: ActionFormValues): string | null {
  if (mode === "revise" && !values.content.trim()) return "Write the new content.";
  if (mode === "revise" && values.content.trim() === target.content && !values.epistemicStatus) return "Nothing changed.";
  if (mode === "retire" && !values.reason.trim()) return "Say why it is retired.";
  if (mode === "link" && !values.toUnitId) return "Pick the unit to link to.";
  if (mode === "set_status" && !values.epistemicStatus) return "Pick a status.";
  if (mode === "set_status" && values.epistemicStatus === target.epistemicStatus) return "That is already its status.";
  return null;
}

// Fields every person edit shares: the target, the revision seen, no passages or speech act
function base(target: ActionTarget) {
  return { targetId: target.id, expectedRevisionId: target.currentRevisionId, passageIds: [], speechAct: null };
}

// Builds the typed action for one mode
export function buildPersonAction(mode: ActionMode, target: ActionTarget, values: ActionFormValues): PersonAction {
  switch (mode) {
    case "revise":
      return { type: "revise_claim", ...base(target), input: reviseInput(values) };
    case "retire":
      return { type: "retire_claim", ...base(target), input: { reason: values.reason.trim(), validTo: null } };
    case "link":
      return { type: "link", ...base(target), input: { toUnitId: values.toUnitId, type: values.relationshipType } };
    case "set_status":
      return { type: "set_epistemic_status", ...base(target), input: { epistemicStatus: values.epistemicStatus || target.epistemicStatus } };
  }
}

// Revise input: new content, plus a status only when the person picked one
function reviseInput(values: ActionFormValues) {
  const content = values.content.trim();
  return values.epistemicStatus ? { content, epistemicStatus: values.epistemicStatus } : { content };
}
