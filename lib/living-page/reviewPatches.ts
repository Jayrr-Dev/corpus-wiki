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

export function materializeReviewPatches(proposal: z.infer<typeof pagePatchReviewSchema>, snapshot: PageReviewSnapshot): z.infer<typeof pageReviewSchema> {
  const seen = new Set<string>();
  const edits = proposal.edits.map((edit) => {
    if (seen.has(edit.targetId)) throw new TextPatchError("The review contains conflicting operations on one target.");
    seen.add(edit.targetId);
    if (edit.type === "rename_section") return edit;
    const line = snapshot.lines.find((item) => item.line_id === edit.targetId);
    if (!line || line.author !== "ai") throw new TextPatchError("The review targets an unknown or protected paragraph.");
    if (edit.type === "retire_line" && edit.old_text !== line.content) throw new TextPatchError("A paragraph removal must quote its entire original text exactly.");
    const text = edit.type === "revise_line" ? applyTextPatches(line.content, edit.patches) : edit.reason;
    if (!text.trim()) throw new TextPatchError("Use an explicit retirement to remove a paragraph.");
    return { type: edit.type, targetId: edit.targetId, reason: edit.reason, text };
  });
  return { ...proposal, edits };
}
