import type { DraftAction } from "@/lib/ai/types";
import { type CommitResult, commitPersonEdit } from "@/lib/change-control";
import type { DbRpc } from "@/lib/db/rpc";
import { isBlock } from "./blocks";

// =====================================================================
// A PERSON EDITS A LINE (changes flow both ways). When the line states
// exactly one claim, the edit also revises that claim in the same
// ChangeSet, so every other line citing it turns stale and the living
// page rewrites them. A line stating several claims (or none) changes
// only itself: which claim the new words belong to would be a guess. So
// does a list, table or chart: its layout is not the claim's wording.
// =====================================================================

// DB: read_line
type LineRead = {
  lineId: string;
  lineRevisionId: string;
  sectionId: string;
  content: string;
  claims: { unitId: string; citedRevisionId: string; currentRevisionId: string }[];
};

// Commits a person's new text for one line; returns the commit and its event (to rebuild pages from)
export async function commitLineEdit(db: DbRpc, lineId: string, content: string): Promise<CommitResult & { eventId: string }> {
  const text = content.trim();
  if (!text) throw new Error("A line cannot be empty. Remove it instead.");
  const line = await db.call<LineRead | null>("read_line", { p_line_id: lineId });
  if (!line) throw new Error("The line does not exist or was removed.");
  return commitPersonEdit(db, `Edited a line: ${text}`, lineEditActions(line, text));
}

// The actions for one line edit: [revise_claim, revise_line citing it] or [revise_line]
function lineEditActions(line: LineRead, text: string): DraftAction[] {
  const [claim, ...others] = line.claims;
  const reviseLine = (input: Extract<DraftAction, { type: "revise_line" }>["input"]): DraftAction =>
    ({ type: "revise_line", targetId: line.lineId, expectedRevisionId: null, passageIds: [], speechAct: null, input }) as DraftAction;
  if (!claim || others.length > 0 || isBlock(text) || isBlock(line.content)) {
    const unitRevisionIds = line.claims.map((cited) => cited.citedRevisionId);
    return [reviseLine({ content: text, unitRevisionIds, expectedLineRevisionId: line.lineRevisionId })];
  }
  const reviseClaim = {
    type: "revise_claim",
    targetId: claim.unitId,
    expectedRevisionId: claim.currentRevisionId,
    passageIds: [],
    speechAct: null,
    input: { content: text },
  } as DraftAction;
  // citePositions [0]: the line cites the claim revision action 0 creates
  return [reviseClaim, reviseLine({ content: text, unitRevisionIds: [], citePositions: [0], expectedLineRevisionId: line.lineRevisionId })];
}
