import type { DraftAction, DraftChangeSet, ExistingUnit, ReconciliationClient, ReconciliationInput } from "../types";
import { ALPHA_DATA_DOMAIN, ALPHA_DOMAIN, ALPHA_ENTITY, CANNED_CLAIMS, type CannedClaim } from "./canned";

// TRACE WRITTEN ON EVERY FAKE CHANGESET (no tokens are spent)
const FAKE_TRACE = { modelVersion: "fake", promptVersion: null, tokensIn: 0, tokensOut: 0 } as const;

// FAKE CLIENT: answers the eval fixtures with canned ChangeSets, like a model would.
// It never applies judgement about dates or ties: those are Change control's checks (agent B).
export class FakeReconciliationClient implements ReconciliationClient {
  readonly name = "fake";

  // One canned claim per known file; unknown files get an empty ChangeSet
  async draftChangeSet(input: ReconciliationInput): Promise<DraftChangeSet> {
    const claim = CANNED_CLAIMS[input.source.title];
    if (!claim) return { summary: `No canned answer for ${input.source.title}`, actions: [], trace: FAKE_TRACE };
    const action = buildAction(claim, input);
    return { summary: summarize(action, claim), actions: [action], trace: FAKE_TRACE };
  }
}

// Revises Alpha's database decision when one exists, otherwise adds a new unit
function buildAction(claim: CannedClaim, input: ReconciliationInput): DraftAction {
  const passageIds = input.passages.map((p) => p.id);
  const existing = claim.isDatabaseDecision ? findDatabaseDecision(input.existingUnits) : undefined;
  if (existing) return reviseAction(claim, existing, passageIds);
  return addAction(claim, input.source.sourceDate, passageIds);
}

// The current unit holding Alpha's database decision, if any
function findDatabaseDecision(units: ExistingUnit[]): ExistingUnit | undefined {
  return units.find((u) => u.kind === "decision" && /alpha will use/i.test(u.content));
}

// REVISE: a repeated claim keeps its earlier evidence and gains a second source (E5);
// a changed claim cites only the new passages, since the old ones say something else
function reviseAction(claim: CannedClaim, unit: ExistingUnit, passageIds: string[]): DraftAction {
  const isSameClaim = unit.content === claim.content;
  return {
    type: "revise_claim",
    targetId: unit.unitId,
    expectedRevisionId: unit.revisionId,
    passageIds: isSameClaim ? [...new Set([...unit.passageIds, ...passageIds])] : passageIds,
    speechAct: claim.speechAct,
    input: { content: claim.content, epistemicStatus: claim.epistemicStatus },
  };
}

// ADD: a new unit about Alpha, filed under the data-layer domain when it is about storage
function addAction(claim: CannedClaim, sourceDate: string, passageIds: string[]): DraftAction {
  return {
    type: "add_claim",
    targetId: null,
    expectedRevisionId: null,
    passageIds,
    speechAct: claim.speechAct,
    input: {
      content: claim.content,
      kind: claim.kind,
      epistemicStatus: claim.epistemicStatus,
      validFrom: sourceDate,
      entities: [{ ...ALPHA_ENTITY, role: "subject" }],
      domainPaths: [claim.isDatabaseDecision ? ALPHA_DATA_DOMAIN : ALPHA_DOMAIN],
    },
  };
}

// One line for the Changes screen
function summarize(action: DraftAction, claim: CannedClaim): string {
  const verb = action.type === "revise_claim" ? "Revise" : "Add";
  return `${verb}: ${claim.content}`;
}
