import type { Embedder } from "@/lib/ai/embeddings";
import type { JudgeDecision, JudgeRequest } from "@/lib/ai/tokenFactory/duplicateJudge";
import type { DraftAction, DraftChangeSet, ExistingUnit, ReconciliationInput } from "@/lib/ai/types";
import type { SimilarUnit } from "@/lib/knowledge/embeddingStore";
import { CANDIDATE_COSINE, type ComparableClaim, comparable, likeness } from "@/lib/knowledge/similarity";

// =====================================================================
// DUPLICATE GUARD: runs on an upload's draft before it is submitted, so a
// claim the store already holds is not added a second time (a file read
// twice, a rerun, or another file saying the same thing).
//   1. Each new claim (add_claim) gets look-alikes: stored claims near it
//      by meaning (embeddings) or by words, and earlier new claims of the
//      same file. The same text is decided at once.
//   2. The AI judge reads the rest: same claim, same claim plus a detail,
//      or a different claim (lib/ai/tokenFactory/duplicateJudge.ts).
//   3. A repeat of a stored claim becomes a revise_claim on it, in the
//      add's place: the same wording (or the merged wording) with both
//      sets of passages, so the evidence grows and nothing is duplicated.
//      A repeat of an earlier new claim folds into that add.
// Links name new claims by position; positions are remapped after folding
// (a revise in an add's place resolves to the stored unit, see
// change_control.unit_at_position). A failing embedder or judge never
// blocks the upload: the claim is kept and the cleaning cycle catches it.
// =====================================================================

export type GuardDeps = {
  embedder: Embedder | null;
  // Stored live claims near a vector (lib/knowledge/embeddingStore.ts similarUnits)
  findSimilar: (vector: number[]) => Promise<SimilarUnit[]>;
  // The judge's decisions keyed by new-claim ref (lib/ai/tokenFactory/duplicateJudge.ts)
  judge: (request: JudgeRequest) => Promise<Map<string, JudgeDecision>>;
  warn?: (message: string) => void;
};

// Stored look-alikes asked for per new claim
const STORE_CANDIDATES = 5;
// New claims per judge call
const JUDGE_BATCH = 20;

type AddAt = { position: number; action: Extract<DraftAction, { type: "add_claim" }> };
// What became of one new claim: kept, folded into a stored unit, or folded into an earlier add
type Outcome = { kind: "keep" } | { kind: "existing"; unit: ExistingUnit; content: string; reason: string } | { kind: "draft"; into: number; content: string | null };

// reviseStored false (web pages, which only add): a repeat of a stored claim is dropped
// when it says nothing new, and kept as its own claim when it adds a detail
export type GuardOptions = { reviseStored?: boolean };

export async function guardDuplicates(deps: GuardDeps, input: ReconciliationInput, draft: DraftChangeSet, options: GuardOptions = {}): Promise<DraftChangeSet> {
  const reviseStored = options.reviseStored ?? true;
  const adds: AddAt[] = draft.actions.flatMap((action, position) => (action.type === "add_claim" ? [{ position, action }] : []));
  if (!adds.length) return draft;
  const warn = deps.warn ?? ((message: string) => console.error(message));
  const unitsById = new Map(input.existingUnits.map((unit) => [unit.unitId, unit]));
  const stored = input.existingUnits.map((unit) => ({ unit, claim: comparable(unit.content) }));

  // Vectors for the new claims; without them, words alone pick look-alikes
  let vectors: (number[] | null)[] = adds.map(() => null);
  if (deps.embedder) {
    try { vectors = await deps.embedder.embed(adds.map(({ action }) => action.input.content)); }
    catch (error) { warn(`Duplicate guard could not embed new claims: ${message(error)}`); }
  }
  const claims: ComparableClaim[] = adds.map(({ action }, index) => comparable(action.input.content, vectors[index] ?? null));

  // 1. LOOK-ALIKES per new claim; the same text is settled without the judge
  const outcomes: Outcome[] = adds.map(() => ({ kind: "keep" }));
  const candidates: { units: string[]; earlier: number[] }[] = [];
  for (let index = 0; index < adds.length; index++) {
    const units = new Set<string>();
    const vector = vectors[index];
    if (vector) {
      try {
        for (const near of await deps.findSimilar(vector)) if (unitsById.has(near.unitId) && near.similarity >= CANDIDATE_COSINE) units.add(near.unitId);
      } catch (error) { warn(`Duplicate guard could not search stored claims: ${message(error)}`); }
    }
    for (const { unit, claim } of stored) if (likeness(claims[index]!, claim).candidate) units.add(unit.unitId);
    const earlier = adds.slice(0, index).map((_, j) => j).filter((j) => likeness(claims[index]!, claims[j]!).candidate);
    const sameStored = stored.find(({ claim }) => likeness(claims[index]!, claim).exact);
    const sameEarlier = earlier.find((j) => likeness(claims[index]!, claims[j]!).exact);
    if (sameStored) outcomes[index] = { kind: "existing", unit: sameStored.unit, content: sameStored.unit.content, reason: "Same wording as a stored claim" };
    else if (sameEarlier !== undefined) outcomes[index] = { kind: "draft", into: sameEarlier, content: null };
    candidates.push({ units: [...units].slice(0, STORE_CANDIDATES), earlier });
  }

  // 2. THE JUDGE reads every new claim that has look-alikes and no same-text match
  const toJudge = adds.map((_, index) => index).filter((index) => outcomes[index]!.kind === "keep" && (candidates[index]!.units.length || candidates[index]!.earlier.length));
  const unitRefs = new Map<string, string>();
  const unitRef = (unitId: string) => unitRefs.get(unitId) ?? (unitRefs.set(unitId, `U${unitRefs.size + 1}`), unitRefs.get(unitId)!);
  const newRef = (index: number) => `N${index + 1}`;
  for (let start = 0; start < toJudge.length; start += JUDGE_BATCH) {
    const batch = toJudge.slice(start, start + JUDGE_BATCH);
    const request: JudgeRequest = {
      claims: batch.map((index) => ({
        ref: newRef(index),
        content: adds[index]!.action.input.content,
        candidates: [...candidates[index]!.units.map(unitRef), ...candidates[index]!.earlier.map(newRef)],
      })),
      known: [],
    };
    const named = new Set(request.claims.flatMap((claim) => claim.candidates));
    request.known = [
      ...[...unitRefs].filter(([, ref]) => named.has(ref)).map(([unitId, ref]) => ({ ref, content: unitsById.get(unitId)!.content })),
      ...adds.map((add, index) => ({ ref: newRef(index), content: add.action.input.content })).filter(({ ref }) => named.has(ref)),
    ];
    let decisions: Map<string, JudgeDecision>;
    try { decisions = await deps.judge(request); }
    catch (error) { warn(`Duplicate judge failed; the new claims are kept: ${message(error)}`); continue; }
    for (const index of batch) {
      const decision = decisions.get(newRef(index));
      if (!decision || decision.verdict === "different" || !decision.match) continue;
      const content = decision.verdict === "adds_detail" ? decision.content!.trim() : null;
      const unitId = [...unitRefs].find(([, ref]) => ref === decision.match)?.[0];
      if (unitId) {
        const unit = unitsById.get(unitId)!;
        outcomes[index] = { kind: "existing", unit, content: content ?? unit.content, reason: decision.reason.trim() };
      } else {
        const into = Number(decision.match.slice(1)) - 1;
        if (into >= 0 && into < index) outcomes[index] = { kind: "draft", into, content };
      }
    }
  }

  // 3. REWRITE: folds follow chains (a repeat of a repeat lands on the first)
  const settle = (index: number): number => {
    const outcome = outcomes[index]!;
    return outcome.kind === "draft" ? settle(outcome.into) : index;
  };
  const actions = [...draft.actions];
  const mergedInto = new Map<number, number>();
  for (let index = 0; index < adds.length; index++) {
    const outcome = outcomes[index]!;
    if (outcome.kind !== "draft") continue;
    const root = settle(index);
    const into = adds[root]!.position;
    const target = actions[into]!;
    const passageIds = [...new Set([...target.passageIds, ...adds[index]!.action.passageIds])];
    // A fold into a claim that itself repeats a stored one adds to that revise
    actions[into] = target.type === "add_claim" && outcome.content
      ? { ...target, passageIds, input: { ...target.input, content: outcome.content } }
      : { ...target, passageIds };
    if (outcomes[root]!.kind === "existing" && outcome.content) {
      const rootOutcome = outcomes[root] as Extract<Outcome, { kind: "existing" }>;
      outcomes[root] = { ...rootOutcome, content: outcome.content };
    }
    mergedInto.set(adds[index]!.position, into);
  }
  // Repeats of stored claims: a revise in the add's place, or nothing when it adds no
  // passage and no wording (a rerun of the same file); links then name the stored unit
  const standsFor = new Map<number, string>();
  for (let index = 0; index < adds.length; index++) {
    const outcome = outcomes[index]!;
    if (outcome.kind !== "existing") continue;
    const position = adds[index]!.position;
    const revise = reviseFor(outcome, actions[position] as AddAt["action"]);
    const known = new Set(outcome.unit.passageIds);
    const sameWording = revise.input.content === outcome.unit.content;
    if (!reviseStored) {
      if (sameWording) standsFor.set(position, outcome.unit.unitId);
    } else if (sameWording && revise.passageIds.every((id) => known.has(id))) standsFor.set(position, outcome.unit.unitId);
    else actions[position] = revise;
  }
  // One action per stored unit: later ones fold into the first (keeping any new wording)
  const firstForUnit = new Map<string, number>();
  actions.forEach((action, position) => {
    if (mergedInto.has(position) || standsFor.has(position) || action.type !== "revise_claim" || !action.targetId) return;
    const first = firstForUnit.get(action.targetId);
    if (first === undefined) {
      firstForUnit.set(action.targetId, position);
      return;
    }
    const kept = actions[first] as Extract<DraftAction, { type: "revise_claim" }>;
    const unit = unitsById.get(action.targetId);
    const content = unit && kept.input.content === unit.content ? action.input.content : kept.input.content;
    actions[first] = { ...kept, passageIds: [...new Set([...kept.passageIds, ...action.passageIds])], input: { ...kept.input, content } };
    mergedInto.set(position, first);
  });

  const changed = mergedInto.size > 0 || standsFor.size > 0 || outcomes.some((outcome) => outcome.kind === "existing");
  return changed ? { ...draft, actions: compact(actions, mergedInto, standsFor) } : draft;
}

// THE REVISE THAT REPLACES A REPEATED ADD: the stored unit's wording (or the merged one),
// pinned to the revision the draft was read against, citing both sets of passages
function reviseFor(outcome: Extract<Outcome, { kind: "existing" }>, add: AddAt["action"]): Extract<DraftAction, { type: "revise_claim" }> {
  const { unit } = outcome;
  return {
    type: "revise_claim",
    targetId: unit.unitId,
    expectedRevisionId: unit.revisionId,
    passageIds: [...new Set([...unit.passageIds, ...add.passageIds])],
    speechAct: add.speechAct,
    input: { content: outcome.content, rationale: `Matches a stored claim${outcome.reason ? `: ${outcome.reason}` : ""}` },
  };
}

// DROPS folded actions, repeats that change nothing (`standsFor`: position -> the stored
// unit it repeats) and the creates no remaining claim needs. Link ends move with them:
// an end on a stored unit (a revise, or a dropped repeat) names the unit; an end on a
// new claim is renumbered.
export function compact(actions: DraftAction[], mergedInto: ReadonlyMap<number, number>, standsFor: ReadonlyMap<number, string> = new Map()): DraftAction[] {
  const adds = actions.filter((action, position) => action.type === "add_claim" && !mergedInto.has(position) && !standsFor.has(position));
  const usedEntities = new Set(adds.flatMap((action) => (action.type === "add_claim" ? action.input.entities.map((e) => `${e.type}:${e.key}`) : [])));
  const usedPaths = new Set(adds.flatMap((action) => (action.type === "add_claim" ? action.input.domainPaths.flatMap(withParents) : [])));
  const dropped = new Set<number>([...mergedInto.keys(), ...standsFor.keys()]);
  actions.forEach((action, position) => {
    if (action.type === "create_entity" && !usedEntities.has(`${action.input.type}:${action.input.key}`)) dropped.add(position);
    if (action.type === "create_domain" && !usedPaths.has(action.input.path)) dropped.add(position);
  });
  const settle = (position: number): number => (mergedInto.has(position) ? settle(mergedInto.get(position)!) : position);
  const renumbered = new Map<number, number>();
  actions.forEach((_, position) => { if (!dropped.has(position)) renumbered.set(position, renumbered.size); });
  // Where a link end lands: a stored unit, a new claim's new position, or nowhere
  const land = (old: number | undefined, unitId: string | null): { unitId: string | null; position?: number } | null => {
    if (old === undefined) return { unitId };
    const position = settle(old);
    const stored = standsFor.get(position);
    if (stored) return { unitId: stored };
    const end = actions[position];
    if (!end || dropped.has(position)) return null;
    if (end.type === "revise_claim" && end.targetId) return { unitId: end.targetId };
    return { unitId: null, position: renumbered.get(position)! };
  };
  const key = (end: { unitId: string | null; position?: number }) => end.unitId ?? `#${end.position}`;
  const seen = new Set<string>();
  return actions.flatMap((action, position): DraftAction[] => {
    if (dropped.has(position)) return [];
    if (action.type !== "link") return [action];
    const from = land(action.input.fromPosition, action.targetId);
    const to = land(action.input.toPosition, action.input.toUnitId);
    if (!from || !to || key(from) === key(to)) return [];
    const symmetric = action.input.type === "related_to" || action.input.type === "contradicts";
    const pair = symmetric && key(to) < key(from) ? `${key(to)}|${key(from)}` : `${key(from)}|${key(to)}`;
    if (seen.has(`${action.input.type}:${pair}`)) return [];
    seen.add(`${action.input.type}:${pair}`);
    const rest = { ...action.input };
    delete rest.fromPosition;
    delete rest.toPosition;
    return [{
      ...action,
      targetId: from.unitId,
      input: { ...rest, toUnitId: to.unitId, ...(from.position === undefined ? {} : { fromPosition: from.position }), ...(to.position === undefined ? {} : { toPosition: to.position }) },
    }];
  });
}

const withParents = (path: string) => path.split("/").map((_, i, parts) => parts.slice(0, i + 1).join("/"));
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
