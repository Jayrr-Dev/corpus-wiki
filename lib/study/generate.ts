import "server-only";
import { z } from "zod";
import { addUsage, chatJson, type TokenFactorySettings, type TokenUsage } from "@/lib/ai/chat";
import { TUTOR_INSTRUCTIONS } from "@/lib/ai/rolePolicies";
import type { ScopeClaim } from "@/lib/knowledge/scope";
import { CHOICE_COUNT, STUDY_KINDS, type StudyKind } from "./types";

// =====================================================================
// WRITE STUDY QUESTIONS: the Tutor turns a scope's claims into questions,
// about ten claims per call, one question per claim and chosen type.
// Wrong options for multiple choice come from sibling claims in the same
// scope, so they are plausible but wrong. Every item keeps the claim
// (unit_id) and the revision it was written from (revision_id).
// =====================================================================

export const STUDY_PROMPT_VERSION = "study-questions-v1";
export const BATCH_SIZE = 10;
// Siblings sent with each batch as material for wrong options
const SIBLING_LIMIT = 20;

export type GeneratedItem = { unitId: string; revisionId: string; kind: StudyKind; prompt: string; answer: string; choices: string[] | null; explanation: string };

type Claim = Pick<ScopeClaim, "unitId" | "revisionId" | "title" | "content">;

const text = (max: number) => z.string().trim().min(1).max(max);
export const questionSchema = z.object({
  items: z.array(z.object({
    claim: z.string().describe("The ref of the claim the question tests, such as c1."),
    kind: z.enum(STUDY_KINDS),
    prompt: text(600).describe("Flashcard front, or the question."),
    answer: text(600).describe("Flashcard back, the right option, or the expected short answer."),
    wrongChoices: z.array(text(300)).max(CHOICE_COUNT - 1).describe("Multiple choice only: three plausible wrong options from the sibling claims. Empty for other kinds."),
    explanation: z.string().trim().max(400).describe("One sentence on why the answer is right, from the claim."),
  })),
});

// Fisher-Yates with an injectable random source, so tests can pin the order
export function shuffle<T>(values: readonly T[], random: () => number = Math.random): T[] {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other]!, copy[index]!];
  }
  return copy;
}

// A drafted question as an item, or null when it does not hold up (unknown claim, kind not asked for,
// or multiple choice without three distinct wrong options that differ from the answer)
export function toItem(draft: z.infer<typeof questionSchema>["items"][number], refs: ReadonlyMap<string, Claim>, kinds: readonly StudyKind[], random: () => number = Math.random): GeneratedItem | null {
  const claim = refs.get(draft.claim.trim());
  if (!claim || !kinds.includes(draft.kind)) return null;
  const base = { unitId: claim.unitId, revisionId: claim.revisionId, kind: draft.kind, prompt: draft.prompt, answer: draft.answer, explanation: draft.explanation };
  if (draft.kind !== "multiple_choice") return { ...base, choices: null };
  const key = (value: string) => value.trim().toLowerCase();
  const wrong = [...new Map(draft.wrongChoices.map((choice) => [key(choice), choice])).values()].filter((choice) => key(choice) !== key(draft.answer));
  if (wrong.length !== CHOICE_COUNT - 1) return null;
  return { ...base, choices: shuffle([draft.answer, ...wrong], random) };
}

export type GenerateOptions = {
  // The Tutor's instructions (Agent Roles can override them)
  instructions?: string;
  // Other claims in the scope, for wrong options
  siblings?: readonly Claim[];
  batchSize?: number;
  random?: () => number;
  signal?: AbortSignal;
  // Questions written so far, of `total` asked for
  onProgress?: (done: number, total: number) => void;
  // Each batch's items as soon as they are written (so a long set saves as it goes)
  onBatch?: (items: GeneratedItem[]) => Promise<void>;
};

// WRITE QUESTIONS for claims: one per claim and kind, in batches through the Tutor
export async function generateStudyItems(settings: TokenFactorySettings, claims: readonly Claim[], kinds: readonly StudyKind[], options: GenerateOptions = {}): Promise<{ items: GeneratedItem[]; usage: TokenUsage }> {
  const size = options.batchSize ?? BATCH_SIZE;
  const total = claims.length * kinds.length;
  const items: GeneratedItem[] = [];
  let usage: TokenUsage = { tokensIn: 0, tokensOut: 0 };
  let done = 0;
  options.onProgress?.(0, total);
  for (let start = 0; start < claims.length; start += size) {
    const batch = claims.slice(start, start + size);
    const refs = new Map(batch.map((claim, index) => [`c${index + 1}`, claim]));
    const inBatch = new Set(batch.map((claim) => claim.unitId));
    const siblings = (options.siblings ?? claims).filter((claim) => !inBatch.has(claim.unitId)).slice(0, SIBLING_LIMIT);
    const result = await chatJson(settings, {
      name: "study_questions", subject: batch[0]?.title ?? undefined, schema: questionSchema, jsonSchema: z.toJSONSchema(questionSchema),
      maxTokens: 900 * batch.length * kinds.length, retryInvalidOutput: true, signal: options.signal,
      messages: [
        { role: "system", content: options.instructions ?? TUTOR_INSTRUCTIONS },
        { role: "system", content: `Write exactly one question for every claim and every kind in kinds (${kinds.join(", ")}). Set claim to the claim's ref. For multiple_choice give exactly ${CHOICE_COUNT - 1} wrongChoices, each the length and style of the answer, taken from the sibling claims where they fit; for other kinds wrongChoices is []. Never put the answer among the wrong choices.` },
        { role: "user", content: JSON.stringify({ kinds, claims: [...refs].map(([ref, claim]) => ({ ref, title: claim.title, claim: claim.content })), siblings: siblings.map((claim) => ({ title: claim.title, claim: claim.content })) }) },
      ],
    });
    usage = addUsage(usage, result);
    const written = result.value.items.map((draft) => toItem(draft, refs, kinds, options.random)).filter((item): item is GeneratedItem => item !== null);
    // One question per claim and kind, even if the model repeats one
    const seen = new Set<string>();
    const unique = written.filter((item) => { const key = `${item.unitId}:${item.kind}`; if (seen.has(key)) return false; seen.add(key); return true; });
    if (unique.length) await options.onBatch?.(unique);
    items.push(...unique);
    done += batch.length * kinds.length;
    options.onProgress?.(done, total);
  }
  return { items, usage };
}
