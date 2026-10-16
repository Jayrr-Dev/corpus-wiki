import { AUTO_MERGE_COSINE, cosine } from "@/lib/knowledge/similarity";

// =====================================================================
// CURATOR SCORING: plain math over the page tree, no AI. A page is the set
// of claims its lines cite, so two pages repeat each other when they cite the
// same claims (or near-identical ones by vector). The scores find candidates
// for the Curator to judge and measure the tree before and after a run.
// =====================================================================

// SETTINGS
// A claim counts as already on another page when it is the same claim, or this close by vector
const SAME_CLAIM_COSINE = AUTO_MERGE_COSINE;
// Share of a page's claims found on another page that makes it a duplicate of it
export const DUPLICATE_CONTAINMENT = 0.9;
// Share that makes the pair worth judging
const CANDIDATE_CONTAINMENT = 0.6;
// Page vectors this close are on the same subject, whatever claims they cite
const SAME_SUBJECT_SIMILARITY = 0.9;
// Pages citing this many claims or fewer are stubs
export const STUB_CLAIMS = 2;
// Titles this similar by word overlap are hard to tell apart
const SIMILAR_TITLE_OVERLAP = 0.75;
// Claims an organization page may repeat from the pages under it (its overview's opening)
export const ORGANIZATION_REPEAT_ALLOWANCE = 3;

// TYPES
export type CuratorPage = {
  id: string;
  title: string;
  parentId: string | null;
  articleType: string | null;
  scope: string | null;
  // The organization or topic the page is filed under (its entity or context entity)
  contextName: string | null;
  // An organization's own page (titled after a company, agency, project…): it stays as the parent of its pages
  organization: boolean;
  claimIds: string[];
  lines: number;
  sections: string[];
};
export type ClaimVectors = ReadonlyMap<string, readonly number[]>;
export type PairScore = { a: string; b: string; aInB: number; bInA: number; shared: number; similarity: number | null };
export type CandidateKind = "duplicate" | "contained" | "same_subject" | "stub" | "misplaced" | "similar_titles" | "untyped" | "top_level";
export type Candidate = { kind: CandidateKind; pageIds: string[]; detail: string };
export type TreeHealth = {
  pages: number;
  roots: number;
  stubs: number;
  duplicatePairs: number;
  // Organization pages repeating more than a short opening's worth of the claims under them
  organizationOverlaps: number;
  misplaced: number;
  similarTitlePairs: number;
  untyped: number;
  avgChildParentSimilarity: number | null;
  claimsCited: number;
};

// =====================================================================
// PAIRS
// =====================================================================

// Share of a's claims that b also states: the same claim, or a near-identical one by vector
export function containment(a: readonly string[], b: readonly string[], vectors: ClaimVectors): number {
  if (!a.length) return 0;
  const inB = new Set(b);
  const bVectors = b.map((id) => vectors.get(id)).filter((v): v is readonly number[] => !!v);
  const covered = a.filter((id) => {
    if (inB.has(id)) return true;
    const vector = vectors.get(id);
    return !!vector && bVectors.some((other) => cosine(vector, other) >= SAME_CLAIM_COSINE);
  });
  return covered.length / a.length;
}

// The mean of a page's claim vectors; null when none of its claims has one
export function pageVector(claimIds: readonly string[], vectors: ClaimVectors): number[] | null {
  const found = claimIds.map((id) => vectors.get(id)).filter((v): v is readonly number[] => !!v);
  if (!found.length) return null;
  return found[0]!.map((_, k) => found.reduce((sum, v) => sum + v[k]!, 0) / found.length);
}

// Every pair of pages, scored both ways
export function scorePairs(pages: readonly CuratorPage[], vectors: ClaimVectors): PairScore[] {
  const pv = new Map(pages.map((page) => [page.id, pageVector(page.claimIds, vectors)]));
  const pairs: PairScore[] = [];
  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      const a = pages[i]!, b = pages[j]!;
      const va = pv.get(a.id), vb = pv.get(b.id);
      const inB = new Set(b.claimIds);
      pairs.push({
        a: a.id, b: b.id,
        aInB: containment(a.claimIds, b.claimIds, vectors),
        bInA: containment(b.claimIds, a.claimIds, vectors),
        shared: a.claimIds.filter((id) => inB.has(id)).length,
        similarity: va && vb ? cosine(va, vb) : null,
      });
    }
  }
  return pairs;
}

// =====================================================================
// TITLES
// =====================================================================

const STOP_WORDS = new Set(["a", "an", "and", "at", "for", "in", "of", "on", "the", "to", "&"]);
// The words of a title that carry meaning, with acronyms in brackets dropped ("(ULA)")
export function titleWords(title: string): Set<string> {
  return new Set(title.toLowerCase().replace(/\([^)]*\)/g, " ").split(/[^a-z0-9]+/).filter((word) => word && !STOP_WORDS.has(word)));
}
export function titleOverlap(a: string, b: string): number {
  const wa = titleWords(a), wb = titleWords(b);
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const word of wa) if (wb.has(word)) shared++;
  return shared / Math.min(wa.size, wb.size);
}

// =====================================================================
// TREE
// =====================================================================

// Pages next to a page in the tree: its parent, its children and its siblings
function neighbours(page: CuratorPage, pages: readonly CuratorPage[]): Set<string> {
  return new Set(pages.filter((other) => other.id !== page.id && (
    other.id === page.parentId || other.parentId === page.id || (other.parentId === page.parentId && page.parentId !== null)
  )).map((other) => other.id));
}

// The page most like this one by vector, when there is one
function nearestPage(page: CuratorPage, pairs: readonly PairScore[]): { id: string; similarity: number } | null {
  let best: { id: string; similarity: number } | null = null;
  for (const pair of pairs) {
    if (pair.similarity === null || (pair.a !== page.id && pair.b !== page.id)) continue;
    const other = pair.a === page.id ? pair.b : pair.a;
    if (!best || pair.similarity > best.similarity) best = { id: other, similarity: pair.similarity };
  }
  return best;
}

// A page whose closest page by meaning sits elsewhere in the tree, and is close enough to matter
function misplacedPages(pages: readonly CuratorPage[], pairs: readonly PairScore[]): { page: CuratorPage; nearest: string; similarity: number }[] {
  return pages.flatMap((page) => {
    const nearest = nearestPage(page, pairs);
    if (!nearest || nearest.similarity < SAME_SUBJECT_SIMILARITY) return [];
    const near = neighbours(page, pages);
    const nearestPageRow = pages.find((p) => p.id === nearest.id);
    // Already next to it, or the nearest page is its own descendant/ancestor through one step
    if (near.has(nearest.id) || nearestPageRow?.parentId === page.id) return [];
    return [{ page, nearest: nearest.id, similarity: nearest.similarity }];
  });
}

// A thin page that is neither an organization page nor a page that holds others (a hub)
export function isStub(page: CuratorPage, pages: readonly CuratorPage[]): boolean {
  return !page.organization && page.claimIds.length <= STUB_CLAIMS && !pages.some((other) => other.parentId === page.id);
}

const isDuplicate = (pair: PairScore) => Math.max(pair.aInB, pair.bInA) >= DUPLICATE_CONTAINMENT;

// True when pageId sits anywhere under rootId
function isUnder(byId: ReadonlyMap<string, CuratorPage>, pageId: string, rootId: string): boolean {
  const seen = new Set<string>();
  let at = byId.get(pageId)?.parentId;
  while (at && !seen.has(at)) { if (at === rootId) return true; seen.add(at); at = byId.get(at)?.parentId ?? null; }
  return false;
}

// True when one page of the pair is an organization page and the other sits under it:
// the overview's job (the Planner's), not a duplicate for the Curator
function organizationOverlap(pair: PairScore, byId: ReadonlyMap<string, CuratorPage>): boolean {
  return (!!byId.get(pair.a)?.organization && isUnder(byId, pair.b, pair.a)) || (!!byId.get(pair.b)?.organization && isUnder(byId, pair.a, pair.b));
}

// THE TREE'S HEALTH: the numbers a Curator run should move
export function treeHealth(pages: readonly CuratorPage[], vectors: ClaimVectors, pairs = scorePairs(pages, vectors)): TreeHealth {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const pv = new Map(pages.map((page) => [page.id, pageVector(page.claimIds, vectors)]));
  const childParent = pages.flatMap((page) => {
    const parent = page.parentId ? byId.get(page.parentId) : undefined;
    const a = pv.get(page.id), b = parent ? pv.get(parent.id) : null;
    return a && b ? [cosine(a, b)] : [];
  });
  let similarTitlePairs = 0;
  for (let i = 0; i < pages.length; i++) for (let j = i + 1; j < pages.length; j++) {
    if (titleOverlap(pages[i]!.title, pages[j]!.title) >= SIMILAR_TITLE_OVERLAP) similarTitlePairs++;
  }
  const duplicates = pairs.filter(isDuplicate);
  return {
    pages: pages.length,
    roots: pages.filter((page) => !page.parentId || !byId.has(page.parentId)).length,
    stubs: pages.filter((page) => isStub(page, pages)).length,
    duplicatePairs: duplicates.filter((pair) => !organizationOverlap(pair, byId)).length,
    organizationOverlaps: pages.filter((page) => {
      if (!page.organization) return false;
      const below = new Set(pages.filter((other) => other.id !== page.id && isUnder(byId, other.id, page.id)).flatMap((other) => other.claimIds));
      return page.claimIds.filter((id) => below.has(id)).length > ORGANIZATION_REPEAT_ALLOWANCE;
    }).length,
    misplaced: misplacedPages(pages, pairs).length,
    similarTitlePairs,
    untyped: pages.filter((page) => !page.articleType).length,
    avgChildParentSimilarity: childParent.length ? childParent.reduce((s, v) => s + v, 0) / childParent.length : null,
    claimsCited: new Set(pages.flatMap((page) => page.claimIds)).size,
  };
}

// =====================================================================
// CANDIDATES: what the Curator is asked to judge
// =====================================================================

const pct = (value: number) => `${Math.round(value * 100)}%`;

export function findCandidates(pages: readonly CuratorPage[], vectors: ClaimVectors, pairs = scorePairs(pages, vectors)): Candidate[] {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const title = (id: string) => `“${byId.get(id)?.title ?? id}”`;
  const candidates: Candidate[] = [];
  for (const pair of pairs) {
    if (organizationOverlap(pair, byId)) continue;
    const [small, large, share] = pair.aInB >= pair.bInA ? [pair.a, pair.b, pair.aInB] : [pair.b, pair.a, pair.bInA];
    if (pair.aInB >= DUPLICATE_CONTAINMENT && pair.bInA >= DUPLICATE_CONTAINMENT) {
      candidates.push({ kind: "duplicate", pageIds: [pair.a, pair.b], detail: `${title(pair.a)} and ${title(pair.b)} state the same claims (${pct(pair.aInB)} / ${pct(pair.bInA)}).` });
    } else if (share >= CANDIDATE_CONTAINMENT) {
      candidates.push({ kind: "contained", pageIds: [small, large], detail: `${pct(share)} of ${title(small)}'s claims are already on ${title(large)}.` });
    } else if ((pair.similarity ?? 0) >= SAME_SUBJECT_SIMILARITY) {
      candidates.push({ kind: "same_subject", pageIds: [pair.a, pair.b], detail: `${title(pair.a)} and ${title(pair.b)} are on the same subject (similarity ${pair.similarity!.toFixed(2)}) but share few claims.` });
    } else if (titleOverlap(byId.get(pair.a)!.title, byId.get(pair.b)!.title) >= SIMILAR_TITLE_OVERLAP) {
      candidates.push({ kind: "similar_titles", pageIds: [pair.a, pair.b], detail: `${title(pair.a)} and ${title(pair.b)} have titles that are hard to tell apart.` });
    }
  }
  for (const page of pages) {
    if (isStub(page, pages)) candidates.push({ kind: "stub", pageIds: [page.id], detail: `${title(page.id)} cites only ${page.claimIds.length} claim(s) in ${page.lines} line(s).` });
    if (!page.articleType) candidates.push({ kind: "untyped", pageIds: [page.id], detail: `${title(page.id)} has no article type or scope.` });
  }
  // The top level holds organizations and broad subjects: a lone page there is misfiled
  for (const page of pages) {
    if (!page.organization && !page.parentId && !pages.some((child) => child.parentId === page.id)) {
      candidates.push({ kind: "top_level", pageIds: [page.id], detail: `${title(page.id)} sits at the top level but is neither an organization nor a subject that holds other pages.` });
    }
  }
  for (const { page, nearest, similarity } of misplacedPages(pages, pairs)) {
    candidates.push({ kind: "misplaced", pageIds: [page.id, nearest], detail: `${title(page.id)} is closest to ${title(nearest)} (similarity ${similarity.toFixed(2)}), which is not its parent, child or sibling.` });
  }
  return candidates;
}
