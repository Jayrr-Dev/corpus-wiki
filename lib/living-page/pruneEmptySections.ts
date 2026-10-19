import "server-only";
import type { DbRpc } from "@/lib/db/rpc";
import { commitChangeSet, submitChangeSet } from "@/lib/change-control";
import type { SectionState } from "./types";

// Retire empty generated scaffolding through the normal undoable action path.
export async function pruneEmptySections(db: DbRpc, sectionIds: string[]): Promise<number> {
  const empty: string[] = [];
  for (const sectionId of sectionIds) {
    const state = await db.call<SectionState>("read_section_state", { p_section_id: sectionId });
    // Failed writing is retryable work, not disposable scaffolding.
    if (state.units?.length) continue;
    if (!state.lines.some((line) => line.author === "person" || line.content.trim())
      && !await db.call<boolean>("composer_section_has_images", { p_section_id: sectionId })) empty.push(sectionId);
  }
  if (!empty.length) return 0;
  const { changeSetId } = await submitChangeSet(db, { eventId: null, cause: "edit", actor: "ai" }, {
    summary: "Removed empty generated sections after article update",
    trace: { modelVersion: null, promptVersion: "article-empty-cleanup-v1", tokensIn: 0, tokensOut: 0 },
    actions: empty.map((id) => ({ type: "retire_section", targetId: id, expectedRevisionId: null, passageIds: [], speechAct: null, input: {} })),
  });
  const result = await commitChangeSet(db, changeSetId);
  if (result.status !== "applied") throw new Error("Empty-section cleanup was not fully applied. Review Changes before retrying.");
  return empty.length;
}
