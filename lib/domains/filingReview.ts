// =====================================================================
// FILING REVIEW FORMAT: the independent review must assess every proposed
// destination with exactly its refs. A review that approved the proposal but
// slipped on that format used to discard the placement and rerun both
// calls. Its assessments are now matched in code, and only destinations it
// left unassessed (or refs it left out of one) go back for a format-only
// re-review. Refs it listed in the wrong destination are simply ignored.
// =====================================================================

export type ReviewParent = { path: string; refs: string[] };

export function reconcileReviewParents<P extends ReviewParent & { reason: string }>(reviewed: P[], parents: ReviewParent[]) {
  const byPath = new Map<string, P[]>();
  for (const parent of reviewed) byPath.set(parent.path.trim(), [...byPath.get(parent.path.trim()) ?? [], parent]);
  const assessed: (ReviewParent & { reason: string })[] = [];
  const missing: ReviewParent[] = [];
  for (const parent of parents) {
    const entries = byPath.get(parent.path) ?? [];
    const covered = new Set(entries.flatMap(entry => entry.refs.map(ref => ref.trim().toUpperCase())));
    const unassessed = parent.refs.filter(ref => !covered.has(ref));
    if (unassessed.length) missing.push({ path: parent.path, refs: parent.refs });
    else assessed.push({ ...parent, reason: entries.map(entry => entry.reason).join(" ") });
  }
  return { assessed, missing };
}

// The refs a rejection asks to correct: every named current ref, and every current member
// of a destination an issue names without listing its refs
export function correctionRefsFor(issues: string[], parents: ReviewParent[], current: ReadonlySet<string>): Set<string> {
  const refs = new Set(issues.flatMap(issue => issue.match(/\bC\d+\b/g) ?? []).filter(ref => current.has(ref)));
  for (const parent of parents) if (issues.some(issue => issue.includes(parent.path))) for (const ref of parent.refs) refs.add(ref);
  return refs;
}
