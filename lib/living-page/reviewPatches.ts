import { z } from "zod";
import { pageReviewSchema, type PageReviewSnapshot } from "./pageReview";
import { applyTextPatches, textPatchSchema, TextPatchError } from "./textPatch";

const target = { targetId: z.uuid(), reason: z.string().trim().min(1).max(2000) };
export const pagePatchReviewSchema = pageReviewSchema.extend({
  edits: z.array(z.discriminatedUnion("type", [
    z.object({ ...target, type: z.literal("revise_line"), patches: z.array(textPatchSchema) }),
    z.object({ ...target, type: z.literal("retire_line"), old_text: z.string().min(1) }),
    z.object({ ...target, type: z.literal("rename_section"), text: z.string().trim().min(1).max(150) }),
  ])).max(12).default([]),
});

// dropMisquoted: after a corrective retry, a paragraph edit whose quoted text still cannot be
// found, or a second edit to the same target, is left out instead of failing the whole review;
// the other edits and the findings stand. So is one aimed at an unknown or protected paragraph,
// which then stays exactly as it was.
export function materializeReviewPatches(proposal: z.infer<typeof pagePatchReviewSchema>, snapshot: PageReviewSnapshot, dropMisquoted = false): z.infer<typeof pageReviewSchema> {
  const seen = new Set<string>();
  const edits = proposal.edits.flatMap((edit): z.infer<typeof pageReviewSchema>["edits"] => {
    if (seen.has(edit.targetId)) {
      if (dropMisquoted) return [];
      throw new TextPatchError("The review contains conflicting operations on one target.");
    }
    seen.add(edit.targetId);
    if (edit.type === "rename_section") return [edit];
    const line = snapshot.lines.find((item) => item.line_id === edit.targetId);
    const misquoted = (message: string): [] => { if (dropMisquoted) return []; throw new TextPatchError(message); };
    if (!line || line.author !== "ai") return misquoted("The review targets an unknown or protected paragraph.");
    if (edit.type === "retire_line" && edit.old_text !== line.content) return misquoted("A paragraph removal must quote its entire original text exactly.");
    let text = edit.reason;
    if (edit.type === "revise_line") {
      try { text = applyTextPatches(line.content, edit.patches); }
      catch (error) {
        if (!(error instanceof TextPatchError)) throw error;
        return misquoted(error.message);
      }
    }
    if (!text.trim()) return misquoted("Use an explicit retirement to remove a paragraph.");
    return [{ type: edit.type, targetId: edit.targetId, reason: edit.reason, text }];
  });
  return { ...proposal, edits };
}
