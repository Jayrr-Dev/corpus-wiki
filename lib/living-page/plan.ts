import type { DraftAction, SectionQuery } from "@/lib/ai/types";
import { docBlockText, isDocBlockContent, parseDocBlock } from "@/lib/docs/blocks";
import { unsupportedProseNumbers, withSupportedCharts } from "./blocks";
import type { SectionRevision, SectionState } from "./types";

// =====================================================================
// SECTION PLAN (pure): what a section needs, and the writer's answer
// turned into line actions for Change control. The writer may only touch
// flagged lines and may only cite claims the section shows; anything
// else in its answer is dropped here, and so is a chart whose numbers
// the cited claims do not state, and a line whose prose does.
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

// A claim the review left out, and that no surviving line still cites, leaves the
// section. The stored claim stays; this section stops trying to write it again.
export function releaseIrrelevantClaims(sectionId: string, query: SectionQuery | null | undefined, omitted: ReadonlySet<string>, stillCited: ReadonlySet<string>): DraftAction | null {
  const unitIds = query?.unitIds;
  if (!unitIds?.length || !omitted.size) return null;
  const next = unitIds.filter((id) => !omitted.has(id) || stillCited.has(id));
  if (next.length === unitIds.length) return null;
  return { type: "update_section_query", targetId: sectionId, expectedRevisionId: null, passageIds: [], speechAct: null, input: { query: { ...query, unitIds: next }, fromQuery: query } };
}

// A line dropped because its prose states numbers its cited claims do not
export type DroppedLine = { text: string; numbers: number[] };

// The writer's answer as write_line / revise_line / retire_line actions; `onDropped` hears each
// line the number check removes, so the caller can log how often the writer invents numbers
export function revisionToActions(revision: SectionRevision, state: SectionState, onDropped?: (line: DroppedLine) => void): DraftAction[] {
  const flagged = new Map(state.lines.filter((line) => line.needsRewrite).map((line) => [line.lineId, line]));
  const revisionOf = new Map(state.units.map((unit) => [unit.unitId, unit.revisionId]));
  const cite = (unitIds: string[]) => [...new Set(unitIds.flatMap((id) => revisionOf.get(id) ?? []))];
  const supported = supportedText(state, onDropped, revision.textPatches);
  const handled = new Set<string>();
  const actions: DraftAction[] = [];
  for (const { lineId, unitIds, ...answer } of revision.revise) {
    const text = supported(answer.text, unitIds);
    const line = flagged.get(lineId);
    const citations = cite(unitIds);
    if (revision.textPatches && (!line || handled.has(lineId) || !text.trim() || !citations.length || text !== answer.text || unitIds.some((id) => !revisionOf.has(id)))) {
      throw new Error("The paragraph edit could not be validated; no text patches were saved.");
    }
    if (!line || handled.has(lineId) || !text.trim() || citations.length === 0) continue;
    handled.add(lineId);
    if (revision.textPatches && text === line.content && line.unitRevisionIds && sameSet(citations, line.unitRevisionIds)) continue;
    actions.push(lineAction("revise_line", lineId, { content: revision.textPatches ? text : text.trim(), unitRevisionIds: citations, expectedLineRevisionId: line.lineRevisionId }));
  }
  for (const lineId of revision.retire) {
    const line = flagged.get(lineId);
    if (revision.textPatches && (!line || handled.has(lineId))) throw new Error("The paragraph removal conflicts with another edit; no text patches were saved.");
    if (!line || handled.has(lineId)) continue;
    handled.add(lineId);
    actions.push(lineAction("retire_line", lineId, { expectedLineRevisionId: line.lineRevisionId }));
  }
  return [...actions, ...writeActions(revision, state, cite, supported)];
}

function sameSet(left: string[], right: string[]): boolean {
  return new Set(left).size === new Set(right).size && left.every((value) => right.includes(value));
}

// The line's text with any chart removed whose values its cited claims do not state,
// or nothing when its prose states a number they do not
function supportedText(state: SectionState, onDropped?: (line: DroppedLine) => void, preserveText = false): (text: string, unitIds: string[]) => string {
  const contentOf = new Map(state.units.map((unit) => [unit.unitId, unit.content]));
  return (text, unitIds) => {
    const claims = unitIds.flatMap((id) => contentOf.get(id) ?? []);
    // A doc block is JSON: check its words, not its ids (lib/docs/blocks.ts)
    if (isDocBlockContent(text)) {
      const numbers = unsupportedProseNumbers(docBlockText(parseDocBlock(text)), [...claims, state.pageTitle, state.title]);
      if (numbers.length === 0) return text;
      onDropped?.({ text, numbers });
      return "";
    }
    const charted = withSupportedCharts(text, claims);
    const numbers = unsupportedProseNumbers(charted, [...claims, state.pageTitle, state.title]);
    if (numbers.length === 0) return preserveText && charted === text.trim() ? text : charted;
    onDropped?.({ text: charted, numbers });
    return "";
  };
}

// New lines go after the last current line, in the writer's order
function writeActions(revision: SectionRevision, state: SectionState, cite: (ids: string[]) => string[], supported: (text: string, ids: string[]) => string): DraftAction[] {
  const lastPosition = Math.max(-1, ...state.lines.map((line) => line.position));
  if (revision.textPatches && revision.add.some((line) => !line.text.trim() || !cite(line.unitIds).length || supported(line.text, line.unitIds) !== line.text)) {
    throw new Error("A new paragraph could not be validated; no text patches were saved.");
  }
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
