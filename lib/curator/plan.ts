import { z } from "zod";
import type { DraftAction } from "@/lib/ai/types";
import type { Candidate, CuratorPage } from "./score";

// =====================================================================
// CURATOR PLAN: the model's answer, checked against the tree, then either
// played out on a copy of the tree (the benchmark) or turned into one
// update_page action per change (a real run).
// Pages are named by short refs (P1, P2…) so the model never handles ids.
// =====================================================================

export const ARTICLE_TYPES = ["entity", "process", "requirement", "concept"] as const;

export const DISPATCH_ROLES = ["reviewer", "planner", "researcher", "proposer"] as const;
// Other roles' runs one Curator pass may start
export const MAX_DISPATCHES = 5;

export const curatorAnswerSchema = z.object({
  proposals: z.array(z.object({
    operation: z.enum(["merge", "move", "rename", "set_type", "group"]),
    page: z.string(),
    // group: every page filed under the new page (page is the first of them)
    pages: z.array(z.string()).nullable(),
    into: z.string().nullable(),
    parent: z.string().nullable(),
    title: z.string().nullable(),
    sectionTitle: z.string().nullable(),
    articleType: z.enum(ARTICLE_TYPES).nullable(),
    scope: z.string().nullable(),
    confident: z.boolean(),
    reason: z.string(),
  })),
  // Work handed to another role on one page (after the structural changes); the proposer takes no page
  dispatches: z.array(z.object({
    role: z.enum(DISPATCH_ROLES),
    page: z.string().nullable(),
    heading: z.string().nullable(),
    note: z.string(),
    reason: z.string(),
  })),
  summary: z.string(),
});
export type CuratorAnswer = z.infer<typeof curatorAnswerSchema>;
type Proposal = CuratorAnswer["proposals"][number];

// A checked proposal, in page ids
export type CuratorChange =
  | { operation: "merge"; pageId: string; intoPageId: string; sectionTitle: string; unitIds: string[]; confident: boolean; reason: string }
  | { operation: "move"; pageId: string; parentPageId: string | null; confident: boolean; reason: string }
  | { operation: "rename"; pageId: string; title: string; confident: boolean; reason: string }
  | { operation: "set_type"; pageId: string; articleType: (typeof ARTICLE_TYPES)[number]; scope: string; confident: boolean; reason: string }
  | { operation: "group"; pageId: string; pageIds: string[]; title: string; articleType: (typeof ARTICLE_TYPES)[number]; scope: string; parentPageId: string | null; confident: boolean; reason: string };
export type Skipped = { proposal: Proposal; why: string };
// claimIds: the stored claims no page cites that the scores filed under the Planner's page,
// or, for the Article Proposer, the ones that fit no page (it proposes new articles for them)
type DispatchFields = { heading: string | null; note: string; reason: string; claimIds: string[] };
export type PageDispatch = DispatchFields & { role: Exclude<(typeof DISPATCH_ROLES)[number], "proposer">; pageId: string };
export type Dispatch = PageDispatch | (DispatchFields & { role: "proposer"; pageId: null });

// =====================================================================
// WHAT THE MODEL READS
// =====================================================================

export function pageRefs(pages: readonly CuratorPage[]): { refOf: Map<string, string>; idOf: Map<string, string> } {
  const refOf = new Map(pages.map((page, i) => [page.id, `P${i + 1}`]));
  return { refOf, idOf: new Map([...refOf].map(([id, ref]) => [ref, id])) };
}

export function curatorEvidence(input: {
  charter: unknown;
  pages: readonly CuratorPage[];
  claimTitles: ReadonlyMap<string, string>;
  candidates: readonly Candidate[];
}): string {
  const { refOf } = pageRefs(input.pages);
  const ref = (id: string | null) => (id ? refOf.get(id) ?? null : null);
  return JSON.stringify({
    charter: input.charter,
    pages: input.pages.map((page) => ({
      ref: ref(page.id), title: page.title, parent: ref(page.parentId), type: page.articleType, scope: page.scope,
      organization: page.contextName, organizationPage: page.organization, claimCount: page.claimIds.length, lineCount: page.lines, sections: page.sections,
      claims: page.claimIds.map((id) => input.claimTitles.get(id) ?? "(untitled claim)"),
    })),
    candidates: input.candidates.map((candidate) => ({
      kind: candidate.kind, pages: candidate.pageIds.map(ref), detail: candidate.detail,
    })),
  });
}

// =====================================================================
// CHECK: drop proposals that name unknown pages, collide with an earlier
// proposal, would loop the tree, or merge two organizations
// =====================================================================

// The tree as parent links, for the loop check as changes play out
function isWithin(parents: ReadonlyMap<string, string | null>, pageId: string, rootId: string): boolean {
  const seen = new Set<string>();
  let at: string | null | undefined = pageId;
  while (at && !seen.has(at)) {
    if (at === rootId) return true;
    seen.add(at);
    at = parents.get(at);
  }
  return false;
}

export function checkAnswer(answer: CuratorAnswer, pages: readonly CuratorPage[]): { changes: CuratorChange[]; skipped: Skipped[] } {
  const { idOf } = pageRefs(pages);
  const byId = new Map(pages.map((page) => [page.id, page]));
  const parents = new Map(pages.map((page) => [page.id, page.parentId]));
  const claims = new Map(pages.map((page) => [page.id, new Set(page.claimIds)]));
  const removed = new Set<string>();
  const structural = new Set<string>(); // pages already in a merge or move
  const changes: CuratorChange[] = [];
  const skipped: Skipped[] = [];
  const skip = (proposal: Proposal, why: string) => skipped.push({ proposal, why });

  for (const proposal of answer.proposals) {
    const pageId = idOf.get(proposal.page);
    if (!pageId || removed.has(pageId)) { skip(proposal, "unknown or already merged page"); continue; }
    const base = { pageId, confident: proposal.confident, reason: proposal.reason.trim() };
    switch (proposal.operation) {
      case "merge": {
        const intoId = proposal.into ? idOf.get(proposal.into) : undefined;
        if (!intoId || intoId === pageId || removed.has(intoId)) { skip(proposal, "no page to merge into"); break; }
        if (structural.has(pageId)) { skip(proposal, "page already merged or moved in this run"); break; }
        if (byId.get(pageId)!.organization) { skip(proposal, "organization pages stay as parents"); break; }
        const a = byId.get(pageId)!.contextName, b = byId.get(intoId)!.contextName;
        if (a && b && a !== b) { skip(proposal, `pages belong to different organizations (${a}, ${b})`); break; }
        const into = claims.get(intoId)!;
        const unitIds = [...claims.get(pageId)!].filter((id) => !into.has(id));
        changes.push({ ...base, operation: "merge", intoPageId: intoId, unitIds,
          sectionTitle: proposal.sectionTitle?.trim() || byId.get(pageId)!.title });
        // Play it out, so later proposals see the merged tree
        for (const id of unitIds) into.add(id);
        if (isWithin(parents, intoId, pageId)) parents.set(intoId, parents.get(pageId) ?? null);
        for (const [child, parent] of parents) if (parent === pageId && child !== intoId) parents.set(child, intoId);
        removed.add(pageId);
        structural.add(pageId);
        break;
      }
      case "move": {
        const parentId = proposal.parent ? idOf.get(proposal.parent) : null;
        if (parentId === undefined || (parentId && removed.has(parentId))) { skip(proposal, "unknown parent"); break; }
        if (structural.has(pageId)) { skip(proposal, "page already merged or moved in this run"); break; }
        if (parentId && isWithin(parents, parentId, pageId)) { skip(proposal, "would put the page under itself"); break; }
        if ((parents.get(pageId) ?? null) === parentId) { skip(proposal, "already there"); break; }
        changes.push({ ...base, operation: "move", parentPageId: parentId });
        parents.set(pageId, parentId);
        structural.add(pageId);
        break;
      }
      case "rename": {
        const title = proposal.title?.trim();
        if (!title || title === byId.get(pageId)!.title) { skip(proposal, "no new title"); break; }
        if (byId.get(pageId)!.organization) { skip(proposal, "organization pages keep the organization's name"); break; }
        changes.push({ ...base, operation: "rename", title });
        break;
      }
      case "set_type": {
        if (!proposal.articleType) { skip(proposal, "no article type"); break; }
        changes.push({ ...base, operation: "set_type", articleType: proposal.articleType, scope: proposal.scope?.trim() ?? "" });
        break;
      }
      case "group": {
        const title = proposal.title?.trim();
        const refs = [...new Set([proposal.page, ...(proposal.pages ?? [])])];
        const pageIds = refs.map((ref) => idOf.get(ref));
        const parentId = proposal.parent ? idOf.get(proposal.parent) : null;
        if (!title || !proposal.articleType) { skip(proposal, "a new page needs a title and a type"); break; }
        if (pages.some((other) => other.title.trim().toLowerCase() === title.toLowerCase())) { skip(proposal, "a page already has that title"); break; }
        if (pageIds.some((id) => !id || removed.has(id))) { skip(proposal, "unknown or already merged page"); break; }
        const ids = pageIds as string[];
        if (ids.some((id) => structural.has(id))) { skip(proposal, "page already merged or moved in this run"); break; }
        if (ids.some((id) => byId.get(id)!.organization)) { skip(proposal, "organization pages stay at the top"); break; }
        if (parentId === undefined || (parentId && removed.has(parentId))) { skip(proposal, "unknown parent"); break; }
        if (parentId && ids.some((id) => isWithin(parents, parentId, id))) { skip(proposal, "would put the new page under a page it holds"); break; }
        changes.push({ ...base, pageId: ids[0]!, operation: "group", pageIds: ids, title, articleType: proposal.articleType, scope: proposal.scope?.trim() ?? "", parentPageId: parentId });
        const newId = `new:${title}`;
        parents.set(newId, parentId);
        for (const id of ids) { parents.set(id, newId); structural.add(id); }
        break;
      }
    }
  }
  return { changes, skipped };
}

// DISPATCHES: known pages that still exist after the changes, a heading for the
// Researcher, at most MAX_DISPATCHES, one per page and role. A Planner dispatch
// carries the claims no page cites that the scores filed under its page.
export function checkDispatches(answer: CuratorAnswer, pages: readonly CuratorPage[], changes: readonly CuratorChange[], candidates: readonly Candidate[] = []): { dispatches: Dispatch[]; skipped: string[] } {
  const { idOf } = pageRefs(pages);
  const missing = new Map(candidates.flatMap((candidate) => (candidate.kind === "missing_claims" ? [[candidate.pageIds[0]!, candidate.claimIds ?? []] as const] : [])));
  const uncovered = candidates.find((candidate) => candidate.kind === "uncovered")?.claimIds ?? [];
  const mergedAway = new Set(changes.flatMap((change) => (change.operation === "merge" ? [change.pageId] : [])));
  const seen = new Set<string>();
  const dispatches: Dispatch[] = [];
  const skipped: string[] = [];
  for (const item of answer.dispatches) {
    const fields = { heading: item.heading?.trim() || null, note: item.note.trim(), reason: item.reason.trim() };
    if (item.role === "proposer") {
      if (!uncovered.length) { skipped.push("proposer: no claims that fit no page"); continue; }
      if (seen.has("proposer") || dispatches.length >= MAX_DISPATCHES) { skipped.push("proposer: over the limit or repeated"); continue; }
      seen.add("proposer");
      dispatches.push({ ...fields, role: "proposer", pageId: null, heading: null, claimIds: [...uncovered] });
      continue;
    }
    const pageId = item.page ? idOf.get(item.page) : undefined;
    const key = `${item.role}:${pageId}`;
    if (!pageId || mergedAway.has(pageId)) { skipped.push(`${item.role} ${item.page}: unknown or merged page`); continue; }
    if (item.role === "researcher" && !item.heading?.trim()) { skipped.push(`researcher ${item.page}: needs a section heading`); continue; }
    if (seen.has(key) || dispatches.length >= MAX_DISPATCHES) { skipped.push(`${item.role} ${item.page}: over the limit or repeated`); continue; }
    seen.add(key);
    dispatches.push({ ...fields, role: item.role, pageId, claimIds: item.role === "planner" ? [...(missing.get(pageId) ?? [])] : [] });
  }
  return { dispatches, skipped };
}

// =====================================================================
// PLAY OUT: the tree after the changes (for before/after numbers)
// =====================================================================

export function applyChanges(pages: readonly CuratorPage[], changes: readonly CuratorChange[]): CuratorPage[] {
  const tree = new Map(pages.map((page) => [page.id, { ...page, claimIds: [...page.claimIds], sections: [...page.sections] }]));
  const parents = () => new Map([...tree.values()].map((page) => [page.id, page.parentId]));
  for (const change of changes) {
    const page = tree.get(change.pageId);
    if (!page) continue;
    switch (change.operation) {
      case "merge": {
        const into = tree.get(change.intoPageId);
        if (!into) break;
        into.claimIds.push(...change.unitIds);
        if (change.unitIds.length) into.sections.push(change.sectionTitle);
        into.lines += change.unitIds.length ? page.lines : 0;
        if (isWithin(parents(), into.id, page.id)) into.parentId = page.parentId;
        for (const child of tree.values()) if (child.parentId === page.id && child.id !== into.id) child.parentId = into.id;
        tree.delete(page.id);
        break;
      }
      case "move": page.parentId = change.parentPageId; break;
      case "rename": page.title = change.title; break;
      case "set_type": page.articleType = change.articleType; page.scope = change.scope || page.scope; break;
      case "group": {
        const id = `new:${change.title}`;
        tree.set(id, { id, title: change.title, parentId: change.parentPageId, articleType: change.articleType, scope: change.scope || null,
          contextName: null, organization: false, claimIds: [], lines: 0, sections: [] });
        for (const moved of change.pageIds) { const row = tree.get(moved); if (row) row.parentId = id; }
        break;
      }
    }
  }
  return [...tree.values()];
}

// =====================================================================
// TO CHANGE CONTROL: one update_page action per change
// =====================================================================

// titles: the pages' titles when proposed, so a person reviewing it reads names, not ids
export function changeToAction(change: CuratorChange, title?: (id: string) => string): DraftAction {
  const titles = title ? {
    page: title(change.pageId),
    ...(change.operation === "merge" ? { into: title(change.intoPageId) } : {}),
    ...((change.operation === "move" || change.operation === "group") && change.parentPageId ? { parent: title(change.parentPageId) } : {}),
    ...(change.operation === "group" ? { pages: change.pageIds.map(title) } : {}),
  } : undefined;
  const common = { curator: true as const, confident: change.confident, reason: change.reason, ...(titles ? { titles } : {}) };
  const input = change.operation === "merge"
    ? { ...common, operation: change.operation, intoPageId: change.intoPageId, sectionTitle: change.sectionTitle, unitIds: change.unitIds }
    : change.operation === "move" ? { ...common, operation: change.operation, parentPageId: change.parentPageId }
    : change.operation === "rename" ? { ...common, operation: change.operation, title: change.title }
    : change.operation === "group" ? { ...common, operation: change.operation, title: change.title, articleType: change.articleType, scope: change.scope, parentPageId: change.parentPageId, pageIds: change.pageIds }
    : { ...common, operation: change.operation, articleType: change.articleType, scope: change.scope };
  return { type: "update_page", input, targetId: change.pageId, expectedRevisionId: null, passageIds: [], speechAct: null };
}

// One line for the Changes screen
export function describeChange(change: CuratorChange, title: (id: string) => string): string {
  switch (change.operation) {
    case "merge": return `Curator: merge “${title(change.pageId)}” into “${title(change.intoPageId)}”`;
    case "move": return `Curator: move “${title(change.pageId)}” ${change.parentPageId ? `under “${title(change.parentPageId)}”` : "to the top level"}`;
    case "rename": return `Curator: rename “${title(change.pageId)}” to “${change.title}”`;
    case "set_type": return `Curator: mark “${title(change.pageId)}” as ${change.articleType}`;
    case "group": return `Curator: file ${change.pageIds.map((id) => `“${title(id)}”`).join(", ")} under a new page “${change.title}”`;
  }
}
