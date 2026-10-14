import type { DraftAction, ExistingUnit, ReconciliationInput } from "@/lib/ai/types";
import { passageRef, unitRef } from "./prompt";
import type { AnswerClaim, AnswerEntityRef, ReconciliationAnswer } from "./schema";

// =====================================================================
// MODEL ANSWER -> DRAFT ACTIONS. Resolves the short refs to ids, drops
// claims that cite nothing real, and puts the create_domain and
// create_entity actions a claim needs BEFORE it (Change control applies
// in position order, so the add_claim finds them by path and key).
// =====================================================================

type Refs = { passages: Map<string, string>; units: Map<string, ExistingUnit> };

// The whole conversion: creates first, then one action per usable claim
export function answerToActions(answer: ReconciliationAnswer, input: ReconciliationInput): DraftAction[] {
  const refs = buildRefs(input);
  const claimActions = dedupeTargets(answer.claims.flatMap((claim) => claimToAction(claim, refs, input)));
  return [...domainCreates(claimActions, input.domainPaths), ...entityCreates(answer.claims, claimActions, input), ...claimActions];
}

// Ref -> id maps for passages and units
function buildRefs(input: ReconciliationInput): Refs {
  return {
    passages: new Map(input.passages.map((p, i) => [passageRef(i), p.id])),
    units: new Map(input.existingUnits.map((u, i) => [unitRef(i), u])),
  };
}

// ONE CLAIM -> ONE ACTION (or none when it cites no real passage or unit)
function claimToAction(claim: AnswerClaim, refs: Refs, input: ReconciliationInput): DraftAction[] {
  const passageIds = claim.passages.flatMap((ref) => refs.passages.get(ref.trim()) ?? []);
  if (passageIds.length === 0 || !claim.content.trim()) return [];
  if (claim.action === "add") return [addClaim(claim, passageIds, input.source.sourceDate)];
  const unit = claim.unit ? refs.units.get(claim.unit.trim()) : undefined;
  if (!unit) return claim.action === "revise" ? [addClaim(claim, passageIds, input.source.sourceDate)] : [];
  return [changeUnit(claim, unit, passageIds)];
}

// ADD: a new unit with its entities and domains named by key and path
function addClaim(claim: AnswerClaim, passageIds: string[], sourceDate: string): DraftAction {
  return {
    type: "add_claim",
    targetId: null,
    expectedRevisionId: null,
    passageIds,
    speechAct: claim.speechAct,
    input: {
      content: claim.content.trim(),
      kind: claim.kind,
      epistemicStatus: claim.epistemicStatus,
      validFrom: sourceDate,
      entities: uniqueEntities(claim.entities).map(({ type, key, role }) => ({ type, key, role })),
      domainPaths: [...new Set(claim.domainPaths.map(normalizePath).filter(Boolean))],
    },
  };
}

// REVISE / RETIRE / SET STATUS on an existing unit, pinned to the revision the model saw
function changeUnit(claim: AnswerClaim, unit: ExistingUnit, passageIds: string[]): DraftAction {
  const base = { targetId: unit.unitId, expectedRevisionId: unit.revisionId, speechAct: claim.speechAct };
  if (claim.action === "retire") return { ...base, type: "retire_claim", passageIds, input: { reason: claim.reason, validTo: null } };
  if (claim.action === "set_status")
    return { ...base, type: "set_epistemic_status", passageIds, input: { epistemicStatus: claim.epistemicStatus } };
  // The same sentence again is more evidence for it: keep the earlier passages too (E5)
  const isSameClaim = sameText(unit.content, claim.content);
  return {
    ...base,
    type: "revise_claim",
    passageIds: isSameClaim ? [...new Set([...unit.passageIds, ...passageIds])] : passageIds,
    input: { content: isSameClaim ? unit.content : claim.content.trim(), epistemicStatus: claim.epistemicStatus },
  };
}

// One action per existing unit: a second claim about the same unit is dropped
function dedupeTargets(actions: DraftAction[]): DraftAction[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    if (!action.targetId) return true;
    if (seen.has(action.targetId)) return false;
    seen.add(action.targetId);
    return true;
  });
}

// CREATE_DOMAIN for every new path an add_claim uses, parents first
function domainCreates(actions: DraftAction[], existingPaths: string[]): DraftAction[] {
  const known = new Set(existingPaths);
  const wanted = actions.flatMap((a) => (a.type === "add_claim" ? a.input.domainPaths : []));
  const missing = [...new Set(wanted.flatMap(withParents))].filter((path) => !known.has(path));
  return missing
    .sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))
    .map((path) => ({
      type: "create_domain",
      targetId: null,
      expectedRevisionId: null,
      passageIds: [],
      speechAct: null,
      input: { name: path.split("/").at(-1) ?? path, path, parentPath: parentOf(path) },
    }));
}

// CREATE_ENTITY for every entity an add_claim names that the store does not have
function entityCreates(claims: AnswerClaim[], actions: DraftAction[], input: ReconciliationInput): DraftAction[] {
  const known = new Set(input.entities.map((e) => `${e.type}:${e.key}`));
  const used = new Set(actions.flatMap((a) => (a.type === "add_claim" ? a.input.entities.map((e) => `${e.type}:${e.key}`) : [])));
  return uniqueEntities(claims.flatMap((c) => c.entities))
    .filter((e) => used.has(`${e.type}:${e.key}`) && !known.has(`${e.type}:${e.key}`))
    .map((e) => ({
      type: "create_entity",
      targetId: null,
      expectedRevisionId: null,
      passageIds: [],
      speechAct: null,
      input: { type: e.type, key: e.key, name: e.name, aliases: [] },
    }));
}

// ENTITIES WITH NORMALIZED KEYS, each (type, key) once
function uniqueEntities(refs: AnswerEntityRef[]): AnswerEntityRef[] {
  const byKey = new Map<string, AnswerEntityRef>();
  for (const ref of refs) {
    const entity = { ...ref, type: slug(ref.type), key: slug(ref.key) };
    if (entity.type && entity.key && !byKey.has(`${entity.type}:${entity.key}`)) byKey.set(`${entity.type}:${entity.key}`, entity);
  }
  return [...byKey.values()];
}

// SMALL TEXT HELPERS
const slug = (text: string) => text.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
const normalizePath = (path: string) => path.split("/").map((part) => part.trim()).filter(Boolean).join("/");
const depth = (path: string) => path.split("/").length;
const parentOf = (path: string) => (depth(path) > 1 ? path.split("/").slice(0, -1).join("/") : null);
const withParents = (path: string) => path.split("/").map((_, i, parts) => parts.slice(0, i + 1).join("/"));
const sameText = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");
