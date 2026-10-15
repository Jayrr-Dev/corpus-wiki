import { z } from "zod";
import type { ChatMessage } from "@/lib/ai/chat";
import type { DraftAction } from "@/lib/ai/types";
import type { Enums } from "@/lib/database/types";
import { contentWords } from "@/lib/graph/related";
import { unitRef } from "./prompt";

// =====================================================================
// DEDUPE PASS (the cleaning cycle): finds claims that say the same thing
// twice (e.g. one file ingested twice, where the model added instead of
// revising) and proposes merging them.
//   1. findDuplicateClusters: a cheap word-overlap filter groups units
//      that MIGHT be duplicates, so the model only reads likely groups.
//   2. The model decides, per group, which units really are the same
//      claim, which one to keep, and (optionally) a merged wording that
//      keeps every detail without adding any.
//   3. dedupeAnswerToActions: a revise_claim on the kept unit (when the
//      wording changes, citing every merged unit's passages) and a
//      merge_duplicates that retires the rest.
// Change control sends an AI merge to a person (check_deletion), so
// nothing is retired until someone confirms it on the Exceptions screen.
// =====================================================================

// PROMPT VERSION: recorded on each ChangeSet this pass drafts
export const DEDUPE_PROMPT_VERSION = "dedupe-v1";

// ONE UNIT THE PASS MAY MERGE (what the model sees, plus what the actions need)
export type DedupeUnit = {
  unitId: string;
  revisionId: string;
  content: string;
  kind: Enums<"unit_kind">;
  epistemicStatus: Enums<"epistemic_status">;
  passageIds: string[];
  createdAt: string;
};

// CANDIDATE FILTER: share of the shorter claim's content words the longer one also has
const OVERLAP_THRESHOLD = 0.6;
// Claims this short match too easily on word overlap alone
const MIN_WORDS = 4;
// Units per model call; a bigger cluster is split
export const DEDUPE_CLUSTER_MAX = 12;

// Overlap coefficient of two word sets: |A ∩ B| / min(|A|, |B|)
function overlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  if (small.size === 0) return 0;
  let shared = 0;
  for (const word of small) if (large.has(word)) shared++;
  return shared / small.size;
}

// CLUSTERS: units joined (transitively) by high word overlap. With `focusIds`, only
// clusters that contain at least one of them (e.g. the units an upload just touched).
export function findDuplicateClusters(units: readonly DedupeUnit[], focusIds?: ReadonlySet<string>): DedupeUnit[][] {
  const words = units.map((unit) => new Set(contentWords(unit.content)));
  const parent = units.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)));
  for (let i = 0; i < units.length; i++) {
    if (words[i]!.size < MIN_WORDS) continue;
    for (let j = i + 1; j < units.length; j++) {
      if (words[j]!.size < MIN_WORDS) continue;
      if (overlap(words[i]!, words[j]!) >= OVERLAP_THRESHOLD) parent[root(j)] = root(i);
    }
  }
  const groups = new Map<number, DedupeUnit[]>();
  units.forEach((unit, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), unit]));
  return [...groups.values()]
    .filter((group) => group.length > 1 && (!focusIds || group.some((unit) => focusIds.has(unit.unitId))))
    .flatMap((group) => {
      const chunks: DedupeUnit[][] = [];
      for (let start = 0; start < group.length; start += DEDUPE_CLUSTER_MAX) chunks.push(group.slice(start, start + DEDUPE_CLUSTER_MAX));
      return chunks.filter((chunk) => chunk.length > 1);
    });
}

// WHAT THE MODEL MUST ANSWER
const groupSchema = z.object({
  keep: z.string(),
  duplicates: z.array(z.string()),
  content: z.string().nullable(),
  reason: z.string(),
});

export const dedupeAnswerSchema = z.object({ groups: z.array(groupSchema) });
export type DedupeAnswer = z.infer<typeof dedupeAnswerSchema>;
export const dedupeAnswerJsonSchema = z.toJSONSchema(dedupeAnswerSchema);

const SYSTEM_PROMPT = `You keep a knowledge store of atomic claims ("units") free of duplicates. You read a small batch of units that look alike and decide which ones say the same thing.

Answer with JSON only: { "groups": Group[] }. Each Group is { keep, duplicates, content, reason }.
- Two units are duplicates only if they make the same claim: the same subject, the same question, and no fact that contradicts or changes the other (a different number, date, frequency, scope or party means NOT a duplicate). Wording, order and level of detail may differ.
- A unit that combines several other units into one sentence is a duplicate of them: keep the separate, atomic units and list the combined one in duplicates.
- keep: the ref (e.g. "U2") of the unit to keep. Prefer the unit whose kind and epistemicStatus fit best (a policy or rule is a fact or procedure, not a definition), then the oldest.
- duplicates: refs of the units that are the same claim as keep. Never include keep itself; never put a unit in two groups.
- content: null when keep's wording already holds every detail. Otherwise ONE self-contained sentence (or two at most) that keeps keep's meaning and adds the details only a duplicate has. Never add anything no unit in the group says.
- reason: a few words on why they are the same claim.
- Units that are only related (same topic, different claims) are NOT duplicates. If nothing in the batch is a duplicate, return an empty groups list.`;

// The user message: the batch with short refs instead of ids
export function buildDedupeMessages(units: readonly DedupeUnit[]): ChatMessage[] {
  const payload = {
    units: units.map((unit, index) => ({
      ref: unitRef(index),
      content: unit.content,
      kind: unit.kind,
      epistemicStatus: unit.epistemicStatus,
      created: unit.createdAt.slice(0, 10),
    })),
  };
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(payload) },
  ];
}

const sameText = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");

// ANSWER -> ACTIONS: every revise first (each pinned to the revision the model saw), then
// the merges. Unknown refs, self merges and units already claimed by an earlier group are dropped.
export function dedupeAnswerToActions(answer: DedupeAnswer, units: readonly DedupeUnit[]): DraftAction[] {
  const byRef = new Map(units.map((unit, index) => [unitRef(index), unit]));
  const used = new Set<string>();
  const revises: DraftAction[] = [];
  const merges: DraftAction[] = [];
  for (const group of answer.groups) {
    const keep = byRef.get(group.keep.trim().toUpperCase());
    if (!keep || used.has(keep.unitId)) continue;
    const duplicates = [...new Set(group.duplicates.map((ref) => byRef.get(ref.trim().toUpperCase())))]
      .filter((unit): unit is DedupeUnit => unit !== undefined && unit.unitId !== keep.unitId && !used.has(unit.unitId));
    if (duplicates.length === 0) continue;
    [keep, ...duplicates].forEach((unit) => used.add(unit.unitId));
    const content = group.content?.trim();
    if (content && !sameText(content, keep.content)) {
      revises.push({
        type: "revise_claim",
        targetId: keep.unitId,
        expectedRevisionId: keep.revisionId,
        // The merged wording stands on every merged unit's evidence
        passageIds: [...new Set([keep, ...duplicates].flatMap((unit) => unit.passageIds))],
        speechAct: "stated",
        input: { content },
      });
    }
    merges.push({
      type: "merge_duplicates",
      targetId: keep.unitId,
      expectedRevisionId: null,
      passageIds: [],
      speechAct: null,
      input: { duplicateUnitIds: duplicates.map((unit) => unit.unitId) },
    });
  }
  return [...revises, ...merges];
}
