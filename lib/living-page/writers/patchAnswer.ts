import { z } from "zod";
import { applyTextPatches, textPatchSchema, TextPatchError } from "../textPatch";
import type { SectionReviseInput } from "../types";

export const patchAnswerSchema = z.object({
  revise: z.array(z.object({ line: z.string(), patches: z.array(textPatchSchema), claims: z.array(z.string()) })),
  retire: z.array(z.object({ line: z.string(), old_text: z.string().min(1) })),
  add: z.array(z.object({ text: z.string(), claims: z.array(z.string()) })),
});

// Resolve short refs only against the snapshot sent to the writer. Validation
// finishes before the existing citation checker or commit path sees any text.
export function materializePatchAnswer(answer: z.infer<typeof patchAnswerSchema>, input: SectionReviseInput) {
  const seen = new Set<string>();
  const editable = (ref: string) => {
    const match = /^L([1-9]\d*)$/.exec(ref);
    const line = match ? input.lines[Number(match[1]) - 1] : undefined;
    if (!line || !line.needsRewrite || line.author !== "ai") throw new TextPatchError(`Paragraph ${ref} is unknown or protected.`);
    if (seen.has(ref)) throw new TextPatchError(`Paragraph ${ref} appears in more than one operation.`);
    seen.add(ref);
    return line;
  };
  const citations = (claims: string[]) => {
    if (!claims.length || claims.some((ref) => !/^C[1-9]\d*$/.test(ref) || !input.units[Number(ref.slice(1)) - 1])) {
      throw new TextPatchError("Every resulting paragraph must cite known claims from the supplied evidence.");
    }
    return [...new Set(claims)];
  };
  const revise = answer.revise.map(({ line, patches, claims }) => {
    const text = applyTextPatches(editable(line).content, patches);
    if (!text.trim()) throw new TextPatchError("Use an explicit retire operation to remove a whole paragraph.");
    return { line, text, claims: citations(claims) };
  });
  const retire = answer.retire.map(({ line, old_text }) => {
    if (editable(line).content !== old_text) throw new TextPatchError(`Retirement of ${line} must quote the entire original paragraph exactly.`);
    return line;
  });
  for (const [index, line] of input.lines.entries()) {
    if (line.author === "ai" && line.needsRewrite && (line.needsCitationRefresh ?? line.needsRewrite) && !seen.has(`L${index + 1}`)) {
      throw new TextPatchError(`Paragraph L${index + 1} has changed evidence. Check it and return a patch, citation-only update, or justified retirement.`);
    }
  }
  return { revise, retire, add: answer.add.map((line) => ({ ...line, claims: citations(line.claims) })) };
}
