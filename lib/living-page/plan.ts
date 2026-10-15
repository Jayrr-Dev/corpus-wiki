import type { DraftAction } from "@/lib/ai/types";
import { withSupportedCharts } from "./blocks";
import type { SectionRevision, SectionState } from "./types";

// =====================================================================
// SECTION PLAN (pure): what a section needs, and the writer's answer
// turned into line actions for Change control. The writer may only touch
// flagged lines and may only cite claims the section shows; anything
// else in its answer is dropped here, and so is a chart whose numbers
// the cited claims do not state.
// =====================================================================

// Claims the section shows that no current line states yet
export function uncoveredUnitIds(state: SectionState): string[] {
  const cited = new Set(state.lines.flatMap((line) => line.unitIds));
  return state.units.map((unit) => unit.unitId).filter((unitId) => !cited.has(unitId));
}

// True when the section has a flagged line or an uncovered claim
export function needsRewrite(state: SectionState): boolean {
  return state.lines.some((line) => line.needsRewrite) || uncoveredUnitIds(state).length > 0;
}

// The writer's answer as write_line / revise_line / retire_line actions
export function revisionToActions(revision: SectionRevision, state: SectionState): DraftAction[] {
  const flagged = new Map(state.lines.filter((line) => line.needsRewrite).map((line) => [line.lineId, line]));
  const revisionOf = new Map(state.units.map((unit) => [unit.unitId, unit.revisionId]));
  const cite = (unitIds: string[]) => [...new Set(unitIds.flatMap((id) => revisionOf.get(id) ?? []))];
  const supported = supportedText(state);
  const handled = new Set<string>();
  const actions: DraftAction[] = [];
  for (const { lineId, unitIds, ...answer } of revision.revise) {
    const text = supported(answer.text, unitIds);
    const line = flagged.get(lineId);
    const citations = cite(unitIds);
    if (!line || handled.has(lineId) || !text.trim() || citations.length === 0) continue;
    handled.add(lineId);
    actions.push(lineAction("revise_line", lineId, { content: text.trim(), unitRevisionIds: citations, expectedLineRevisionId: line.lineRevisionId }));
  }
  for (const lineId of revision.retire) {
    const line = flagged.get(lineId);
    if (!line || handled.has(lineId)) continue;
    handled.add(lineId);
    actions.push(lineAction("retire_line", lineId, { expectedLineRevisionId: line.lineRevisionId }));
  }
  return [...actions, ...writeActions(revision, state, cite, supported)];
}

// The line's text with any chart removed whose values its cited claims do not state
function supportedText(state: SectionState): (text: string, unitIds: string[]) => string {
  const contentOf = new Map(state.units.map((unit) => [unit.unitId, unit.content]));
  return (text, unitIds) => withSupportedCharts(text, unitIds.flatMap((id) => contentOf.get(id) ?? []));
}

// New lines go after the last current line, in the writer's order
function writeActions(revision: SectionRevision, state: SectionState, cite: (ids: string[]) => string[], supported: (text: string, ids: string[]) => string): DraftAction[] {
  const lastPosition = Math.max(-1, ...state.lines.map((line) => line.position));
  return revision.add
    .map((line) => ({ content: supported(line.text, line.unitIds).trim(), unitRevisionIds: cite(line.unitIds) }))
    .filter((line) => line.content && line.unitRevisionIds.length > 0)
    .map((line, index) => ({
      type: "write_line",
      targetId: null,
      expectedRevisionId: null,
      passageIds: [],
      speechAct: null,
      input: { sectionId: state.sectionId, position: lastPosition + 1 + index, ...line },
    }));
}

// One action on an existing line
function lineAction<T extends "revise_line" | "retire_line">(
  type: T,
  lineId: string,
  input: Extract<DraftAction, { type: T }>["input"],
): DraftAction {
  return { type, targetId: lineId, expectedRevisionId: null, passageIds: [], speechAct: null, input } as DraftAction;
}
