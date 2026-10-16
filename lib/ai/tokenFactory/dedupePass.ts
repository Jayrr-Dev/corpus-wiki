import { contextsCompatibleForMerge, type KnowledgeContext } from "@/lib/knowledge/context";
import { captureUnitReferences } from "@/lib/ai/unitReferences";
import { z } from "zod";
import type { ChatMessage } from "@/lib/ai/chat";
import type { DraftAction } from "@/lib/ai/types";
import type { Enums } from "@/lib/database/types";
import { AUTO_MERGE_COSINE, type ComparableClaim, comparable, likeness, sameClaimText } from "@/lib/knowledge/similarity";
import { unitRef } from "./prompt";

// =====================================================================
// DEDUPE PASS (the cleaning cycle): finds claims that say the same thing
// twice (e.g. one file ingested twice, where the model added instead of
// revising) and proposes merging them.
//   1. findDuplicateClusters: units close in meaning (embeddings) or in
//      words (lib/knowledge/similarity.ts) are grouped as MIGHT-be
//      duplicates, so the model only reads likely groups.
//   2. The model decides, per group, which units really are the same
//      claim, which one to keep, and (optionally) a merged wording that
//      keeps every detail without adding any.
//   3. dedupeAnswerToActions: a revise_claim on the kept unit (when the
//      wording changes, citing every merged unit's passages) and a
//      merge_duplicates that retires the rest.
// An AI merge waits for a person on Exceptions (check_deletion) unless it
// is marked autoMerge: the model is sure AND every merged unit is the same
// text or nearly the same vector as the kept one (AUTO_MERGE_COSINE).
// Merges only retire, so an auto merge can still be undone.
// =====================================================================

// PROMPT VERSION: recorded on each ChangeSet this pass drafts
export const DEDUPE_PROMPT_VERSION = "dedupe-v4-composites";

// ONE UNIT THE PASS MAY MERGE (what the model sees, plus what the actions need)
export type DedupeUnit = {
  unitId: string;
  revisionId: string;
  content: string;
  kind: Enums<"unit_kind">;
  epistemicStatus: Enums<"epistemic_status">;
  passageIds: string[];
  createdAt: string;
  context?: KnowledgeContext;
  // The composites this unit is a step or item of (sequence: an ordered procedure)
  partOf?: { compositeId: string; sequence: boolean }[];
};

// A composite and its own member are never the same claim, and neither are two steps of
// one procedure (a step may repeat, e.g. "verify" at 3 and at 9: merging would drop one)
export function membersApart(a: DedupeUnit, b: DedupeUnit): boolean {
  if (a.partOf?.some((link) => link.compositeId === b.unitId) || b.partOf?.some((link) => link.compositeId === a.unitId)) return true;
  return Boolean(a.partOf?.some((link) => link.sequence && b.partOf?.some((other) => other.compositeId === link.compositeId)));
}

// Units per model call; a bigger cluster is split
export const DEDUPE_CLUSTER_MAX = 12;

// SAVED VECTORS by revision id (a unit without one is compared by words)
export type UnitVectors = ReadonlyMap<string, readonly number[]>;

const comparables = (units: readonly DedupeUnit[], vectors?: UnitVectors): ComparableClaim[] =>
  units.map((unit) => comparable(unit.content, vectors?.get(unit.revisionId) ?? null));

// CLUSTERS: units joined (transitively) when they may be the same claim. With `focusIds`,
// only clusters that contain at least one of them (e.g. the units an upload just touched).
export function findDuplicateClusters(units: readonly DedupeUnit[], focusIds?: ReadonlySet<string>, vectors?: UnitVectors): DedupeUnit[][] {
  const claims = comparables(units, vectors);
  const parent = units.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)));
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      if (!membersApart(units[i]!, units[j]!) && contextsCompatibleForMerge(units[i]!.context, units[j]!.context) && likeness(claims[i]!, claims[j]!).candidate) parent[root(j)] = root(i);
    }
  }
  const groups = new Map<number, DedupeUnit[]>();
  units.forEach((unit, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), unit]));
  return [...groups.values()]
    .filter((group) => group.length > 1 && (!focusIds || group.some((unit) => focusIds.has(unit.unitId))))
    .flatMap((group) => {
      if (group.length <= DEDUPE_CLUSTER_MAX) return [group];
      // Compare every pair of blocks: slicing into isolated batches misses
      // duplicates on opposite sides of a batch boundary (and drops singletons).
      const blocks: DedupeUnit[][] = [];
      const blockSize = Math.floor(DEDUPE_CLUSTER_MAX / 2);
      for (let start = 0; start < group.length; start += blockSize) blocks.push(group.slice(start, start + blockSize));
      const batches: DedupeUnit[][] = [];
      for (let i = 0; i < blocks.length; i++) {
        for (let j = i + 1; j < blocks.length; j++) {
          const batch = [...blocks[i]!, ...blocks[j]!];
          if (!focusIds || batch.some((unit) => focusIds.has(unit.unitId))) batches.push(batch);
        }
      }
      return batches;
    });
}

// WHAT THE MODEL MUST ANSWER
const groupSchema = z.object({
  keep: z.string(),
  duplicates: z.array(z.string()),
  content: z.string().nullable(),
  confidence: z.enum(["high", "medium"]),
  reason: z.string(),
});

export const dedupeAnswerSchema = z.object({ groups: z.array(groupSchema) });
export type DedupeAnswer = z.infer<typeof dedupeAnswerSchema>;
export const dedupeAnswerJsonSchema = z.toJSONSchema(dedupeAnswerSchema);

const SYSTEM_PROMPT = `You keep a knowledge store of atomic claims ("units") free of duplicates. You read a small batch of units that look alike and decide which ones say the same thing.

Answer with JSON only: { "groups": Group[] }. Each Group is { keep, duplicates, content, confidence, reason }.
- Two units are duplicates only if they make the same claim: the same subject, the same question, and no fact that contradicts or changes the other (a different number, date, frequency, scope or party means NOT a duplicate). Wording, order and level of detail may differ.
- Entity identities, roles, applicability and conditions are part of the claim. Different or unspecified applicability cannot establish equivalence. Never merge on text alone or widen scope.
- A unit that combines several distinct claims is NOT a duplicate of just one of those claims. Never retire a combined unit unless the kept unit preserves all of its facts.
- keep: the ref (e.g. "U2") of the unit to keep. Prefer the unit whose kind and epistemicStatus fit best (a policy or rule is a fact or procedure, not a definition), then the oldest.
- duplicates: refs of the units that are the same claim as keep. Never include keep itself; never put a unit in two groups.
- content: null when keep's wording already holds every detail. Otherwise ONE self-contained sentence (or two at most) that keeps keep's meaning and adds the details only a duplicate has. Never add anything no unit in the group says.
- confidence: "high" only when every duplicate plainly restates keep (nothing to weigh, nothing lost); otherwise "medium", and a person will check it.
- reason: a few words on why they are the same claim.
- Units that are only related (same topic, different claims) are NOT duplicates. If nothing in the batch is a duplicate, return an empty groups list.
- partOf names the composites (a procedure, a list) a unit is a step or item of. A composite is never a duplicate of its own step, and two steps of the same procedure are never duplicates of each other.`;

// The user message: the batch with short refs instead of ids
export function buildDedupeMessages(units: readonly DedupeUnit[]): ChatMessage[] {
  const refOf = new Map(units.map((unit, index) => [unit.unitId, unitRef(index)]));
  const payload = {
    units: units.map((unit, index) => ({
      ref: unitRef(index),
      content: unit.content,
      context: unit.context,
      kind: unit.kind,
      epistemicStatus: unit.epistemicStatus,
      created: unit.createdAt.slice(0, 10),
      ...(unit.partOf?.length ? { partOf: unit.partOf.map((link) => refOf.get(link.compositeId) ?? "a composite outside this batch") } : {}),
    })),
  };
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(payload) },
  ];
}

// AUTO MERGE: the model is sure and every duplicate is the kept unit's text, or its vector
// is nearly the same (both embedded). Word overlap alone never auto-merges.
export function isAutoMerge(confidence: DedupeAnswer["groups"][number]["confidence"], keep: ComparableClaim, duplicates: readonly ComparableClaim[]): boolean {
  if (confidence !== "high") return false;
  return duplicates.every((duplicate) => {
    const alike = likeness(keep, duplicate);
    return alike.exact || (alike.cosine !== null && alike.cosine >= AUTO_MERGE_COSINE);
  });
}

// ANSWER -> ACTIONS: every revise first (each pinned to the revision the model saw), then
// the merges. Unknown refs, self merges and units already claimed by an earlier group are dropped.
// With `vectors`, merges sure enough to skip review carry autoMerge.
export function dedupeAnswerToActions(answer: DedupeAnswer, units: readonly DedupeUnit[], vectors?: UnitVectors): DraftAction[] {
  const compared = comparables(units, vectors);
  const claims = new Map(units.map((unit, index) => [unit.unitId, compared[index]!]));
  const byRef = new Map(units.map((unit, index) => [unitRef(index), unit]));
  const used = new Set<string>();
  const revises: DraftAction[] = [];
  const merges: DraftAction[] = [];
  for (const group of answer.groups) {
    const keep = byRef.get(group.keep.trim().toUpperCase());
    if (!keep || used.has(keep.unitId)) continue;
    const duplicates = [...new Set(group.duplicates.map((ref) => byRef.get(ref.trim().toUpperCase())))]
      .filter((unit): unit is DedupeUnit => unit !== undefined && unit.unitId !== keep.unitId && !used.has(unit.unitId));
    // Reject the whole group: its proposed wording may include an incompatible unit.
    if (duplicates.length === 0 || duplicates.some((unit) => !contextsCompatibleForMerge(keep.context, unit.context))) continue;
    if ([keep, ...duplicates].some((unit, index, group) => group.slice(index + 1).some((other) => membersApart(unit, other)))) continue;
    [keep, ...duplicates].forEach((unit) => used.add(unit.unitId));
    const content = group.content?.trim();
    const references = captureUnitReferences(group.reason, units);
    const rationale = group.reason.trim() ? { rationale: group.reason.trim(), ...(references.length ? { rationaleReferences: references } : {}) } : {};
    if (content && !sameClaimText(content, keep.content)) {
      revises.push({
        type: "revise_claim",
        targetId: keep.unitId,
        expectedRevisionId: keep.revisionId,
        // The merged wording stands on every merged unit's evidence
        passageIds: [...new Set([keep, ...duplicates].flatMap((unit) => unit.passageIds))],
        speechAct: "stated",
        input: { content, ...(keep.context ? { context: keep.context } : {}), ...rationale },
      });
    }
    merges.push({
      type: "merge_duplicates",
      targetId: keep.unitId,
      expectedRevisionId: null,
      passageIds: [],
      speechAct: null,
      input: {
        duplicateUnitIds: duplicates.map((unit) => unit.unitId),
        ...(isAutoMerge(group.confidence, claims.get(keep.unitId)!, duplicates.map((unit) => claims.get(unit.unitId)!)) ? { autoMerge: true } : {}),
        ...rationale,
      },
    });
  }
  return [...revises, ...merges];
}


