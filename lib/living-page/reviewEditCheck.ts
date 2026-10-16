import "server-only";

import type { TokenFactorySettings, TokenUsage } from "@/lib/ai/chat";
import type { PageReviewSnapshot } from "./pageReview";
import { withoutEditorialDashes } from "./punctuation";
import { checkLines, type CheckedClaim, type LineToCheck } from "./writers/lineCheck";

// =====================================================================
// REVIEWER EDIT CHECK: each line the Reviewer rewrites goes through the
// Writer's fact-check before it is saved, against the claims the page
// cites. A rewrite that says more than the claims is dropped (the line
// keeps its checked text). A kept rewrite carries the citations of what
// it now says: claims it states but did not cite are added, and cited
// claims it no longer states are removed. Last, every claim a section
// cites must still be cited by one of its lines, or the next rebuild
// would write it back: a removal or rewrite that breaks this is dropped.
// =====================================================================

type Edit = { type: string; targetId: string; text: string; reason: string };
export type CheckedEdit<E extends Edit> = E & { unitRevisionIds?: string[] };

// The snapshot's claims (current revisions the page cites); the database sends them, the type leaves them out
type SnapshotClaim = { id: string; content: string };
function snapshotClaims(snapshot: PageReviewSnapshot): SnapshotClaim[] {
  const raw = (snapshot as PageReviewSnapshot & { claims?: unknown }).claims;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((claim) => (claim && typeof claim.id === "string" && typeof claim.content === "string" ? [{ id: claim.id, content: claim.content }] : []));
}

export async function checkReviewEdits<E extends Edit>(settings: TokenFactorySettings, snapshot: PageReviewSnapshot, proposed: E[]): Promise<TokenUsage & { edits: CheckedEdit<E>[] }> {
  // Rewrites follow the same punctuation policy as the writer's lines
  const edits = proposed.map((edit) => (edit.type === "revise_line" ? { ...edit, text: withoutEditorialDashes(edit.text) } : edit));
  const claims = snapshotClaims(snapshot);
  const refOf = new Map(claims.map((claim, index) => [claim.id, `C${index + 1}`]));
  const idOf = new Map(claims.map((claim, index) => [`C${index + 1}`, claim.id]));
  const pageClaims: CheckedClaim[] = claims.map((claim) => ({ ref: refOf.get(claim.id)!, claim: claim.content }));
  const claimOf = new Map(pageClaims.map((claim) => [claim.ref, claim]));
  const lineOf = new Map(snapshot.lines.flatMap((line) => (line.line_id ? [[line.line_id, line] as const] : [])));

  // Only line rewrites whose citations the snapshot can show are checked; headings pass through
  const checked: (LineToCheck & { edit: E })[] = edits.flatMap((edit, index) => {
    if (edit.type !== "revise_line") return [];
    const cited = (lineOf.get(edit.targetId)?.unit_revision_ids ?? []).flatMap((id) => (refOf.has(id) ? [claimOf.get(refOf.get(id)!)!] : []));
    return cited.length ? [{ ref: `L${index + 1}`, text: edit.text, claims: cited, edit }] : [];
  });
  if (!checked.length) return { edits: keepSectionsCovered(snapshot, edits), tokensIn: 0, tokensOut: 0 };
  const { verdicts, tokensIn, tokensOut } = await checkLines(settings, { page: snapshot.page.title, section: "Reviewer edits", lines: checked.map(({ ref, text, claims: cited }) => ({ ref, text, claims: cited })), sectionClaims: pageClaims });

  const verdictOf = new Map(verdicts.map((verdict) => [verdict.line, verdict]));
  const checkedOf = new Map(checked.map((line) => [line.edit, line]));
  const kept = edits.flatMap((edit): CheckedEdit<E>[] => {
    const line = checkedOf.get(edit);
    const verdict = line && verdictOf.get(line.ref);
    if (!line || !verdict) return [edit];
    if (!verdict.supported) {
      console.warn("Reviewer edit dropped by the fact-check", { page: snapshot.page.title, targetId: edit.targetId, text: edit.text.slice(0, 200), problem: verdict.problem });
      return [];
    }
    const drop = new Set(verdict.dropCitations ?? []);
    const refs = [...line.claims.map((claim) => claim.ref).filter((ref) => !drop.has(ref)), ...(verdict.addCitations ?? [])];
    const before = line.claims.map((claim) => claim.ref);
    // A rewrite never loses every citation; unchanged citations need no override
    if (!refs.length || (refs.length === before.length && refs.every((ref, index) => ref === before[index]))) return [edit];
    return [{ ...edit, unitRevisionIds: refs.map((ref) => idOf.get(ref)!) }];
  });
  return { edits: keepSectionsCovered(snapshot, kept), tokensIn, tokensOut };
}

// SECTION COVERAGE: drops the edits that would leave a claim of a section cited by none of its lines.
// Removed lines go first (a merge whose rewrite failed leaves its removal uncovered), then rewrites that lost a citation.
export function keepSectionsCovered<E extends Edit>(snapshot: PageReviewSnapshot, edits: CheckedEdit<E>[]): CheckedEdit<E>[] {
  const lines = snapshot.lines.flatMap((line) => (line.line_id && line.section_id ? [{ id: line.line_id, section: line.section_id, cites: line.unit_revision_ids ?? [] }] : []));
  const sectionOf = new Map(lines.map((line) => [line.id, line.section]));
  const gaps = (kept: CheckedEdit<E>[]) => {
    const retired = new Set(kept.filter((edit) => edit.type === "retire_line").map((edit) => edit.targetId));
    const recited = new Map(kept.flatMap((edit) => (edit.type === "revise_line" && edit.unitRevisionIds ? [[edit.targetId, edit.unitRevisionIds] as const] : [])));
    const after = new Map<string, Set<string>>();
    for (const line of lines) if (!retired.has(line.id)) for (const id of recited.get(line.id) ?? line.cites) after.set(line.section, (after.get(line.section) ?? new Set()).add(`${id}`));
    return new Set(lines.flatMap((line) => line.cites.filter((id) => !after.get(line.section)?.has(id)).map((id) => `${line.section}:${id}`)));
  };
  // An edit is to blame when its line held a citation its section has lost
  const blamed = (edit: CheckedEdit<E>, missing: Set<string>) => {
    const line = lines.find((item) => item.id === edit.targetId);
    if (!line) return false;
    const lost = edit.type === "retire_line" ? line.cites : line.cites.filter((id) => edit.unitRevisionIds && !edit.unitRevisionIds.includes(id));
    return lost.some((id) => missing.has(`${sectionOf.get(line.id)}:${id}`));
  };
  let kept = edits;
  for (const type of ["retire_line", "revise_line"]) {
    for (let missing = gaps(kept); missing.size; missing = gaps(kept)) {
      const culprit = kept.find((edit) => edit.type === type && blamed(edit, missing));
      if (!culprit) break;
      console.warn("Reviewer edit dropped: it would leave a claim unstated in its section", { page: snapshot.page.title, type: culprit.type, targetId: culprit.targetId });
      kept = kept.filter((edit) => edit !== culprit);
    }
  }
  return kept;
}
