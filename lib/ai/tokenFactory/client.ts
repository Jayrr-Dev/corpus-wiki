import { reportUploadProgress, workflowStep } from "@/lib/ingest/workflowContext";
import "server-only";

import { chatJson, CompletionLengthError, type TokenFactorySettings } from "@/lib/ai/chat";
import { splitOnCutOff } from "@/lib/ai/splitOnCutOff";
import { skillTrace } from "@/lib/ai/skills/prompt";
import { PROMPT_VERSION } from "@/lib/ai/config";
import type { DraftChangeSet, ReconciliationClient, ReconciliationInput } from "@/lib/ai/types";
import { buildReconciliationMessages, claimRef, earlierClaimRef, passageRef, type EarlierComposite } from "./prompt";
import { reconciliationAnswerSchema, reconciliationJsonSchema, type AnswerClaim, type AnswerLink } from "./schema";
import { answerToActions } from "./toDraft";
import { reuseEntities, reuseFuzzyDomainPaths } from "@/lib/knowledge/nameDuplicates";
import { nameDuplicateJudge, NAME_DUPLICATE_PROMPT_VERSION } from "@/lib/ai/nameDuplicateJudge";

// Bound output growth for long documents without discarding any source passages; every
// batch is checkpointed, so a resume only re-reads the batches that never finished.
// Measured live on a 63-passage .docx (16-passage sample): GLM-5.3-Flash at low effort read
// one 16-passage batch in 11 s, at medium each 8-passage batch took 78-168 s or timed out,
// with the same claims. Low effort keeps big batches well inside the provider timeout.
const MAX_BATCH_CHARS = 6000;
const MAX_BATCH_PASSAGES = 40;

// REAL CLIENT: batched extraction, combined into ONE audited change set per file.
export class TokenFactoryReconciliationClient implements ReconciliationClient {
  readonly name = "token-factory";

  constructor(private readonly settings: TokenFactorySettings) {}

  async draftChangeSet(input: ReconciliationInput): Promise<DraftChangeSet> {
    const claims: AnswerClaim[] = [];
    const links: AnswerLink[] = [];
    const summaries: string[] = [];
    const globalRefs = new Map(input.passages.map((passage, index) => [passage.id, passageRef(index)]));
    let modelVersion: string | null = null;
    let tokensIn: number | null = 0;
    let tokensOut: number | null = 0;
    const countUsage = (incoming: number | null, outgoing: number | null) => {
      tokensIn = tokensIn === null || incoming === null ? null : tokensIn + incoming;
      tokensOut = tokensOut === null || outgoing === null ? null : tokensOut + outgoing;
    };

    const extract = async (passages: ReconciliationInput["passages"]): Promise<void> => {
      const answer = await workflowStep(`extract:${passages.map((p) => p.id).join(":")}`, () => chatJson(this.settings, {
        name: "reconciliation",
        retryInvalidOutput: true,
        subject: input.source.title,
        schema: reconciliationAnswerSchema,
        jsonSchema: reconciliationJsonSchema,
        messages: buildReconciliationMessages({ ...input, passages }, this.settings.skills, earlierComposites(claims, links)),
        // Extraction is careful reading, not puzzle solving: higher efforts only add minutes of hidden thinking
        reasoningEffort: "low",
      }));
      countUsage(answer.tokensIn, answer.tokensOut);
      modelVersion = answer.model;
      const summary = answer.value.summary.trim();
      if (summary) summaries.push(summary);
      const localRefs = new Map(passages.map((passage, index) => [passageRef(index), globalRefs.get(passage.id)!]));
      // Claim refs count from 1 in every batch: shift them past the claims already collected
      const claimOffset = claims.length;
      // An earlier batch's composite (G4) is already counted across the whole file
      const globalClaimRef = (ref: string) => ref.trim()
        .replace(/^C(\d+)$/i, (_, n: string) => claimRef(claimOffset + Number(n) - 1))
        .replace(/^G(\d+)$/i, (_, n: string) => claimRef(Number(n) - 1));
      links.push(...answer.value.links.map((link) => ({ ...link, from: globalClaimRef(link.from), to: globalClaimRef(link.to) })));
      claims.push(...answer.value.claims.map((claim) => ({
        ...claim,
        passages: claim.passages.map((ref) => localRefs.get(ref.trim().toUpperCase()) ?? "INVALID_PASSAGE"),
      })));
    };

    // The status line counts the batches read so far (a split batch still counts once)
    const batches = passageBatches(input.passages);
    for (const [index, passages] of batches.entries()) {
      await reportUploadProgress({ step: "extraction", done: index, total: batches.length });
      // Truncation and timeouts retry in smaller batches; one passage is the hard stop.
      await splitOnCutOff(passages, extract, (error) => { if (error instanceof CompletionLengthError) countUsage(error.tokensIn, error.tokensOut); });
    }
    const countReview = (usage: { tokensIn: number | null; tokensOut: number | null }) => countUsage(usage.tokensIn, usage.tokensOut);
    const resolvedClaims = await reuseEntities(claims, input.entities, nameDuplicateJudge(this.settings, "entity", {
      source: input.source.title, existingKnowledge: input.existingUnits.slice(0, 12).map((unit) => ({ content: unit.content, context: unit.context })),
    }, countReview));
    const domainPaths = await reuseFuzzyDomainPaths([...new Set(resolvedClaims.flatMap((claim) => claim.domainPaths))], input.domainPaths,
      nameDuplicateJudge(this.settings, "domain", { source: input.source.title, claims: resolvedClaims.slice(0, 12).map((claim) => ({ content: claim.content, entities: claim.entities })) }, countReview));
    const canonicalClaims = resolvedClaims.map((claim) => ({ ...claim, domainPaths: claim.domainPaths.map((path) => domainPaths.get(path) ?? path) }));
    return {
      summary: [...new Set(summaries)].join(" ") || `Read ${input.source.title}`,
      // Convert together so entities, domains and updates to the same unit are deduplicated.
      actions: answerToActions({ summary: "", claims: canonicalClaims, links }, input),
      trace: { modelVersion, promptVersion: skillTrace(`${PROMPT_VERSION}+${NAME_DUPLICATE_PROMPT_VERSION}`,["extract_knowledge","identify_entities","link_knowledge","organize_topics","define_concepts"],this.settings.skills), tokensIn, tokensOut },
    };
  }
}

// The composites read so far, so a procedure that runs past a batch keeps its later steps
function earlierComposites(claims: AnswerClaim[], links: AnswerLink[]): EarlierComposite[] {
  return claims.flatMap((claim, index) => {
    if (!claim.structure) return [];
    const ref = claimRef(index);
    const positions = links.filter((link) => link.to === ref && link.type === "part_of").map((link) => link.position ?? 0);
    return [{ ref: earlierClaimRef(index), content: claim.content, structure: claim.structure, lastPosition: Math.max(0, ...positions) }];
  });
}

function passageBatches(passages: ReconciliationInput["passages"]): ReconciliationInput["passages"][] {
  const batches: ReconciliationInput["passages"][] = [];
  let batch: ReconciliationInput["passages"] = [];
  let chars = 0;
  for (const passage of passages) {
    if (batch.length && (batch.length >= MAX_BATCH_PASSAGES || chars + passage.text.length > MAX_BATCH_CHARS)) {
      batches.push(batch);
      batch = [];
      chars = 0;
    }
    batch.push(passage);
    chars += passage.text.length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
