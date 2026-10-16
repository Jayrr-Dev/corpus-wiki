import "server-only";
import { z } from "zod";
import { chatJson, type TokenFactorySettings } from "@/lib/ai/chat";
import { CURATOR_INSTRUCTIONS } from "@/lib/ai/rolePolicies";
import { applyChanges, checkAnswer, checkDispatches, type Dispatch, curatorAnswerSchema, curatorEvidence, type CuratorAnswer, type CuratorChange, type Skipped } from "./plan";
import { findCandidates, missingClaims, scorePairs, titleProblems, treeHealth, type Candidate, type ClaimVectors, type CuratorPage, type TreeHealth, type UnplacedClaim } from "./score";

// =====================================================================
// ONE CURATOR PASS: score the tree, ask the model about what the scores
// flagged, check its answer, and play it out on a copy of the tree. Saves
// nothing: a run (runCurator.ts) or the benchmark decides what happens next.
// =====================================================================

export const CURATOR_PROMPT_VERSION = "curator-v2";

// What the snapshot RPC returns
export type CuratorSnapshot = {
  pages: CuratorPage[];
  claims: { id: string; title: string }[];
  // Live claims no page cites (older fixtures have none)
  unplaced?: UnplacedClaim[];
  vectors: { id: string; vector: string | number[] }[];
};

export type CuratorPass = {
  before: TreeHealth;
  after: TreeHealth;
  candidates: Candidate[];
  answer: CuratorAnswer | null;
  changes: CuratorChange[];
  skipped: Skipped[];
  // Work handed to other roles, run after the changes are saved
  dispatches: Dispatch[];
  dispatchSkipped: string[];
  pagesAfter: CuratorPage[];
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
};

export function readVectors(snapshot: CuratorSnapshot): ClaimVectors {
  return new Map(snapshot.vectors.map((row) => [row.id, typeof row.vector === "string" ? (JSON.parse(row.vector) as number[]) : row.vector]));
}

// Only the connection and call log: the Curator judges with its own instructions, never other roles'
function independent(settings: TokenFactorySettings): TokenFactorySettings {
  return { apiKey: settings.apiKey, model: settings.model, baseUrl: settings.baseUrl, logCall: settings.logCall, roleRoutes: settings.roleRoutes, effort: settings.effort, roleEfforts: settings.roleEfforts };
}

export async function curate(settings: TokenFactorySettings, snapshot: CuratorSnapshot, options: { charter?: unknown; instructions?: string; onProgress?: (detail: string) => void } = {}): Promise<CuratorPass> {
  const progress = options.onProgress ?? (() => {});
  const vectors = readVectors(snapshot);
  const pairs = scorePairs(snapshot.pages, vectors);
  const before = treeHealth(snapshot.pages, vectors, pairs);
  const claimTitles = new Map(snapshot.claims.map((claim) => [claim.id, claim.title]));
  const candidates = [...findCandidates(snapshot.pages, vectors, pairs), ...titleProblems(snapshot.pages, claimTitles), ...missingClaims(snapshot.pages, snapshot.unplaced ?? [], vectors)];
  const empty = { before, after: before, candidates, answer: null, changes: [], skipped: [], dispatches: [], dispatchSkipped: [], pagesAfter: snapshot.pages, model: null, tokensIn: 0, tokensOut: 0 };
  // Nothing flagged, nothing to ask: no AI call
  if (!candidates.length) return empty;

  progress(`Judging ${candidates.length} flagged item(s) across ${snapshot.pages.length} pages…`);
  const evidence = curatorEvidence({ charter: options.charter ?? null, pages: snapshot.pages, claimTitles, candidates });
  const answer = await chatJson(independent(settings), {
    name: "page_structure_review", subject: "Page tree", schema: curatorAnswerSchema, jsonSchema: z.toJSONSchema(curatorAnswerSchema), maxTokens: 12000,
    messages: [{ role: "system", content: options.instructions ?? CURATOR_INSTRUCTIONS }, { role: "user", content: evidence }],
  });
  progress("Checking the proposed changes against the tree…");
  const { changes, skipped } = checkAnswer(answer.value, snapshot.pages);
  const pagesAfter = applyChanges(snapshot.pages, changes);
  const { dispatches, skipped: dispatchSkipped } = checkDispatches(answer.value, snapshot.pages, changes, candidates);
  return { before, after: treeHealth(pagesAfter, vectors), candidates, answer: answer.value, changes, skipped, dispatches, dispatchSkipped, pagesAfter,
    model: answer.model, tokensIn: answer.tokensIn, tokensOut: answer.tokensOut };
}

// SAFETY: every claim some page cited before is still cited after (must always hold)
export function lostClaims(before: readonly CuratorPage[], after: readonly CuratorPage[]): string[] {
  const kept = new Set(after.flatMap((page) => page.claimIds));
  return [...new Set(before.flatMap((page) => page.claimIds))].filter((id) => !kept.has(id));
}
