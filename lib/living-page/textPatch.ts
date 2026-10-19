import { z } from "zod";

export const textPatchSchema = z.object({ old_str: z.string().min(1), new_str: z.string() });
export type TextPatch = z.infer<typeof textPatchSchema>;

export class TextPatchError extends Error {
  constructor(message: string) { super(message); this.name = "TextPatchError"; }
}

// All matches refer to the same original text. Locate every span before applying
// anything; copy unchanged slices directly, without trimming or normalization.
export function applyTextPatches(original: string, patches: readonly TextPatch[]): string {
  const spans = patches.map(({ old_str, new_str }) => {
    if (!old_str) throw new TextPatchError("A search passage cannot be empty. Include adjacent text to anchor an insertion.");
    const start = original.indexOf(old_str);
    if (start < 0) throw new TextPatchError("The search passage is absent from the original paragraph. Read it again and copy the exact text.");
    if (original.indexOf(old_str, start + 1) !== -1) throw new TextPatchError("The search passage matches more than once. Include more surrounding text to identify one occurrence.");
    return { start, end: start + old_str.length, replacement: new_str };
  }).sort((a, b) => a.start - b.start);
  let cursor = 0;
  const parts: string[] = [];
  for (const span of spans) {
    if (span.start < cursor) throw new TextPatchError("Patches overlap. Each patch must address a separate passage in the original paragraph.");
    parts.push(original.slice(cursor, span.start), span.replacement);
    cursor = span.end;
  }
  parts.push(original.slice(cursor));
  return parts.join("");
}

export const TEXT_PATCH_INSTRUCTIONS = `Edit existing text using patches:[{old_str,new_str}]. Copy old_str exactly from the ORIGINAL paragraph; it must occur exactly once. Include surrounding text only when needed to identify the occurrence. All patches refer to the original paragraph, not another patch's result, and must not overlap. Change the smallest passage needed. Preserve all other wording, whitespace, punctuation, paragraph identities and order. Do not delete and recreate a paragraph to edit it. Omit unchanged paragraphs. Use patches:[] for a citation-only update. Never return replacement text for an existing paragraph. When repairing a proposal, return the complete corrected patch plan against the original paragraphs. A failed match is not permission to rewrite the paragraph or section.`;
