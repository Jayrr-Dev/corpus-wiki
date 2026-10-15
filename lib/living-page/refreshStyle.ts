import type { DbRpc } from "@/lib/db/rpc";
import { rebuildSection, type SectionWriter } from "./index";
import { revisionToActions } from "./plan";
import type { SectionReviseInput, SectionRevision, SectionState } from "./types";

// An explicit style refresh may rewrite generated prose, while handwritten lines
// remain protected by the normal action planner and revision preconditions.
export function styleRefreshState(state: SectionState): SectionState {
  return { ...state, lines: state.lines.map((line) => ({ ...line, needsRewrite: line.author === "ai" })) };
}

export function assertStyleCoverage(input: SectionReviseInput, revision: SectionRevision): void {
  const state = { ...input, title: input.sectionTitle, sectionId: "style-preview" };
  const actions = revisionToActions(revision, state);
  const changed = new Set(actions.filter((action) => action.type === "revise_line" || action.type === "retire_line").map((action) => action.targetId));
  const covered = new Set(input.lines.filter((line) => !changed.has(line.lineId)).flatMap((line) => line.unitIds));
  const byRevision = new Map(input.units.map((unit) => [unit.revisionId, unit.unitId]));
  for (const action of actions) if (action.type === "write_line" || action.type === "revise_line") {
    for (const revisionId of action.input.unitRevisionIds) {
      const id = byRevision.get(revisionId);
      if (id) covered.add(id);
    }
  }
  const missing = input.units.filter((unit) => !covered.has(unit.unitId));
  if (missing.length) throw new Error(`Style rewrite omitted ${missing.length} claims; this section was not changed.`);
}

export async function refreshSectionStyle(db: DbRpc, writer: SectionWriter, sectionId: string, updateNote?: string): Promise<void> {
  const refreshWriter: SectionWriter = {
    name: writer.name, promptVersion: writer.promptVersion,
    prepareSection: async (state) => styleRefreshState(state),
    reviseSection: async (input) => {
      const revision = await writer.reviseSection({ ...input, ...(updateNote ? { updateNote } : {}) });
      assertStyleCoverage(input, revision);
      return revision;
    },
  };
  await rebuildSection(db, refreshWriter, sectionId, null);
}
