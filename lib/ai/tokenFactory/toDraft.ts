import { annotateUnitReferences } from "@/lib/ai/unitReferences";
import type { DraftAction, ExistingUnit, ReconciliationInput, Structure } from "@/lib/ai/types";
import { normalizeKnowledgeContext } from "@/lib/knowledge/context";
import { normalizeEntityType } from "@/lib/knowledge/entityTypes";
import { sameClaimText } from "@/lib/knowledge/similarity";
import { reuseDomainPaths } from "@/lib/domains/reusePaths";
import { claimRef, passageRef, unitRef } from "./prompt";
import type { AnswerClaim, AnswerEntityRef, AnswerLink, ReconciliationAnswer } from "./schema";

// =====================================================================
// MODEL ANSWER -> DRAFT ACTIONS. Resolves the short refs to ids, drops
// claims that cite nothing real, and puts the create_domain and
// create_entity actions a claim needs BEFORE it (Change control applies
// in position order, so the add_claim finds them by path and key).
// Links go LAST, naming a new claim by its add_claim's position.
// =====================================================================

type Refs = { passages: Map<string, string>; units: Map<string, ExistingUnit> };

// What a claim ref (C1) or unit ref (U1) points at: an existing unit, or the add_claim that creates one
type LinkEnd = { unitId: string } | { action: DraftAction };

// The whole conversion: creates first, then one action per usable claim, then the links between them
export function answerToActions(answer: Omit<ReconciliationAnswer, "links"> & { links?: AnswerLink[] }, input: ReconciliationInput): DraftAction[] {
  const refs = buildRefs(input);
  const reusePath = reuseDomainPaths(input.domainPaths);
  const claims = answer.claims.map((claim) => ({ ...claim, domainPaths: [...new Set(claim.domainPaths.map(reusePath).filter(Boolean))] }));
  const ends = new Map<string, LinkEnd>();
  const revisions = new Map<string, { content: string; context: string | undefined }>();
  const perClaim = claims.map((claim, index) => {
    let actions = claimToAction(claim, refs, input);
    const revision = actions[0];
    if (revision?.type === "revise_claim" && revision.targetId) {
      const previous = revisions.get(revision.targetId);
      if (previous !== undefined && (!sameClaimText(previous.content, revision.input.content) || previous.context !== JSON.stringify(revision.input.context))) {
        // Let the duplicate guard compare this additional detail. Dropping a second
        // revision here used to lose facts extracted from later document batches.
        actions = [addClaim(claim, revision.passageIds, input.source.sourceDate)];
      } else revisions.set(revision.targetId, { content: revision.input.content, context: JSON.stringify(revision.input.context) });
    }
    const [action] = actions;
    // A retired claim is not linked; a revised or re-stated one links to its existing unit
    if (action?.type === "add_claim") ends.set(claimRef(index), { action });
    else if (action && action.type !== "retire_claim" && action.targetId) ends.set(claimRef(index), { unitId: action.targetId });
    return actions;
  });
  const claimActions = dedupeTargets(perClaim.flat());
  const ordered = [...domainCreates(claimActions, input.domainPaths), ...entityCreates(claims, claimActions, input), ...claimActions];
  return [...ordered, ...linkActions(answer.links ?? [], ends, refs, ordered)].map((action) => annotateUnitReferences(action, input.existingUnits));
}

// LINK: from/to resolved to a unit id or an earlier action's position; unresolvable,
// self and repeated links are dropped (related_to and contradicts count both ways).
// A part_of into a sequence keeps the step's position (memberPosition); a new sequence's
// steps are renumbered 1..n in the file's order. A known member at a new place becomes set_member.
function linkActions(answerLinks: AnswerLink[], ends: Map<string, LinkEnd>, refs: Refs, ordered: DraftAction[]): DraftAction[] {
  const resolve = (ref: string): { unitId: string | null; position?: number; key: string } | null => {
    const clean = ref.trim().toUpperCase();
    const unit = refs.units.get(clean);
    if (unit) return { unitId: unit.unitId, key: unit.unitId };
    const end = ends.get(clean);
    if (!end) return null;
    if ("unitId" in end) return { unitId: end.unitId, key: end.unitId };
    const position = ordered.indexOf(end.action);
    return position < 0 ? null : { unitId: null, position, key: `#${position}` };
  };
  const existing = new Map([...refs.units.values()].map((unit) => [unit.unitId, unit]));
  const structureOf = (end: { unitId: string | null; position?: number }): Structure | null => {
    if (end.unitId) return existing.get(end.unitId)?.structure ?? null;
    const action = end.position === undefined ? undefined : ordered[end.position];
    return action?.type === "add_claim" ? action.input.structure ?? null : null;
  };
  // A part_of from a composite to a plain claim is a step linked backwards (models do this
  // with the first step): turn it round so the step joins its composite
  const links = answerLinks.map((link) => {
    const from = link.type === "part_of" ? resolve(link.from) : null, to = from ? resolve(link.to) : null;
    return from && to && structureOf(from) && !structureOf(to) ? { ...link, from: link.to, to: link.from } : link;
  });
  const positions = stepPositions(links, resolve, structureOf);
  const chains = stepChains(links, resolve, structureOf);
  const seen = new Set<string>();
  return links.flatMap((link, index): DraftAction[] => {
    const from = resolve(link.from), to = resolve(link.to);
    if (!from || !to || from.key === to.key || chains.has(index)) return [];
    const symmetric = link.type === "related_to" || link.type === "contradicts";
    const pair = symmetric && to.key < from.key ? `${to.key}|${from.key}` : `${from.key}|${to.key}`;
    if (seen.has(`${link.type}:${pair}`)) return [];
    seen.add(`${link.type}:${pair}`);
    const memberPosition = positions.get(index);
    const members = to.unitId ? existing.get(to.unitId)?.memberUnitIds ?? [] : [];
    if (link.type === "part_of" && from.unitId && to.unitId && members.includes(from.unitId)) {
      // Already a member: only a new place in the sequence is a change
      if (memberPosition === undefined || memberPosition === members.indexOf(from.unitId) + 1) return [];
      return [{ type: "set_member", targetId: to.unitId, expectedRevisionId: null, passageIds: [], speechAct: null,
        input: { memberUnitId: from.unitId, position: memberPosition, ...rationale(link.reason) } }];
    }
    return [{
      type: "link",
      targetId: from.unitId,
      expectedRevisionId: null,
      passageIds: [],
      speechAct: null,
      input: {
        toUnitId: to.unitId,
        type: link.type,
        ...(from.position === undefined ? {} : { fromPosition: from.position }),
        ...(to.position === undefined ? {} : { toPosition: to.position }),
        ...(memberPosition === undefined ? {} : { memberPosition }),
        ...rationale(link.reason),
      },
    }];
  });
}

// STEP POSITIONS, by link index: only part_of into a sequence. A new sequence's steps are
// renumbered 1..n by the model's numbers, then by the order it listed the links (smaller
// models leave positions out); an existing sequence keeps the numbers it was given.
function stepPositions(
  links: AnswerLink[],
  resolve: (ref: string) => { unitId: string | null; position?: number; key: string } | null,
  structureOf: (end: { unitId: string | null; position?: number }) => Structure | null,
): Map<number, number> {
  const byComposite = new Map<string, { index: number; position: number | null; claim: number }[]>();
  const fixed = new Map<number, number>();
  links.forEach((link, index) => {
    const to = link.type === "part_of" ? resolve(link.to) : null;
    if (!to || structureOf(to)?.type !== "sequence") return;
    const position = typeof link.position === "number" && link.position >= 1 ? Math.round(link.position) : null;
    if (to.unitId) { if (position !== null) fixed.set(index, position); }
    else byComposite.set(to.key, [...(byComposite.get(to.key) ?? []), { index, position, claim: resolve(link.from)?.position ?? Number.MAX_SAFE_INTEGER }]);
  });
  for (const steps of byComposite.values()) {
    // Every step numbered: the model's order. One left out: the file's order (claims come in
    // reading order), so a step without a number is not pushed to the end
    const numbered = steps.every((step) => step.position !== null);
    const ordered = [...steps].sort((a, b) =>
      (numbered ? a.position! - b.position! : a.claim - b.claim) || a.index - b.index);
    ordered.forEach((step, place) => fixed.set(step.index, place + 1));
  }
  return fixed;
}

// STEP CHAINS: a part_of from one step of a composite to another step is not a membership
// (models sometimes chain step 1 -> step 2 -> ...); the composite already holds their order
function stepChains(
  links: AnswerLink[],
  resolve: (ref: string) => { unitId: string | null; position?: number; key: string } | null,
  structureOf: (end: { unitId: string | null; position?: number }) => Structure | null,
): Set<number> {
  const members = new Set<string>();
  for (const link of links) {
    const from = link.type === "part_of" ? resolve(link.from) : null, to = from ? resolve(link.to) : null;
    if (from && to && structureOf(to)) members.add(from.key);
  }
  const chains = new Set<number>();
  links.forEach((link, index) => {
    const from = link.type === "part_of" ? resolve(link.from) : null, to = from ? resolve(link.to) : null;
    if (from && to && !structureOf(to) && members.has(from.key) && members.has(to.key)) chains.add(index);
  });
  return chains;
}

// A composite's shape as the store keeps it: a sequence has no mode
function structure(claim: AnswerClaim): { structure: Structure } | Record<string, never> {
  if (!claim.structure) return {};
  const { type, complete } = claim.structure;
  return { structure: { type, complete, mode: type === "set" ? claim.structure.mode : null } };
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
  const resolved = claim.passages.map((ref) => refs.passages.get(ref.trim().toUpperCase()));
  // A partially invalid citation set may be missing evidence for half the claim.
  if (resolved.some(Boolean) && resolved.some((id) => !id)) throw new Error("A claim cited an unknown passage; retry extraction before saving it.");
  const passageIds = [...new Set(resolved.filter((id): id is string => Boolean(id)))];
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
      ...title(claim.title),
      kind: claim.kind,
      epistemicStatus: claim.epistemicStatus,
      validFrom: sourceDate,
      entities: claimContext(claim).entities,
      context: claimContext(claim),
      domainPaths: [...new Set(claim.domainPaths.map(normalizePath).filter(Boolean))],
      ...structure(claim),
      ...rationale(claim.reason),
    },
  };
}

// REVISE / RETIRE / SET STATUS on an existing unit, pinned to the revision the model saw
function changeUnit(claim: AnswerClaim, unit: ExistingUnit, passageIds: string[]): DraftAction {
  const base = { targetId: unit.unitId, expectedRevisionId: unit.revisionId, speechAct: claim.speechAct };
  if (claim.action === "retire") return { ...base, type: "retire_claim", passageIds, input: { reason: claim.reason, validTo: null } };
  if (claim.action === "set_status")
    return { ...base, type: "set_epistemic_status", passageIds, input: { epistemicStatus: claim.epistemicStatus, ...rationale(claim.reason) } };
  // The same sentence again is more evidence for it: keep the earlier passages too (E5)
  const isSameClaim = sameClaimText(unit.content, claim.content);
  return {
    ...base,
    type: "revise_claim",
    passageIds: isSameClaim ? [...new Set([...unit.passageIds, ...passageIds])] : passageIds,
    input: { ...(claim.applicability ? { context: claimContext(claim) } : {}), content: isSameClaim ? unit.content : claim.content.trim(), ...title(claim.title), ...structure(claim), epistemicStatus: claim.epistemicStatus, ...rationale(claim.reason) },
  };
}

// One action per existing unit: a second claim about the same unit is dropped
function dedupeTargets(actions: DraftAction[]): DraftAction[] {
  const seen = new Map<string, DraftAction>();
  return actions.filter((action) => {
    if (!action.targetId) return true;
    const previous = seen.get(action.targetId);
    if (previous) {
      if (previous.type !== action.type) throw new Error("The source proposed incompatible changes to one claim; retry reconciliation.");
      previous.passageIds = [...new Set([...previous.passageIds, ...action.passageIds])];
      return false;
    }
    seen.set(action.targetId, action);
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
  const used = new Set(actions.flatMap((a) => {
    if (a.type !== "add_claim" && a.type !== "revise_claim") return [];
    const context = a.input.context;
    const entities = context ? [...context.entities, ...context.applicability.entities] : a.type === "add_claim" ? a.input.entities : [];
    return entities.map((e) => `${e.type}:${e.key}`);
  }));
  return uniqueEntities(claims.flatMap((c) => [...c.entities, ...(c.applicability?.entities ?? []).map((e) => ({ ...e, role: "mentioned" as const }))]))
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
    const entity = { ...ref, type: normalizeEntityType(ref.type), key: slug(ref.key) };
    if (entity.type && entity.key && !byKey.has(`${entity.type}:${entity.key}`)) byKey.set(`${entity.type}:${entity.key}`, entity);
  }
  return [...byKey.values()];
}

function claimContext(claim: AnswerClaim) {
  const applicability = claim.applicability;
  const entities = uniqueEntities(claim.entities).map(({ type, key, role }) => ({ type, key, role }));
  const scope = uniqueEntities((applicability?.entities ?? []).map((e) => ({ ...e, role: "subject" as const }))).map(({ type, key }) => ({ type, key }));
  if (applicability && applicability.status !== "scoped" && scope.length) throw new Error("Only scoped applicability may name scope entities.");
  if (applicability?.status === "scoped" && !scope.length && !applicability.conditions?.trim()) throw new Error("Scoped applicability requires entities or conditions.");
  return normalizeKnowledgeContext({ entities, applicability: { status: applicability?.status ?? "unspecified", entities: scope, conditions: applicability?.conditions?.trim() || null } });
}

// SMALL TEXT HELPERS
// The model's reason, kept on the input only when it said one
const rationale = (reason: string) => (reason.trim() ? { rationale: reason.trim() } : {});
// The claim's title, kept only when the model gave one (older answers have none)
const title = (text: string | undefined) => (text?.trim() ? { title: text.trim() } : {});
const slug = (text: string) => text.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
const normalizePath = (path: string) => path.split("/").map((part) => part.trim()).filter(Boolean).join("/");
const depth = (path: string) => path.split("/").length;
const parentOf = (path: string) => (depth(path) > 1 ? path.split("/").slice(0, -1).join("/") : null);
const withParents = (path: string) => path.split("/").map((_, i, parts) => parts.slice(0, i + 1).join("/"));
