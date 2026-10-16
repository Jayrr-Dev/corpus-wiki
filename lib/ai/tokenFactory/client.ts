import { reportUploadProgress, workflowStep } from "@/lib/ingest/workflowContext";
import "server-only";

import { chatJson, CompletionLengthError, ProviderTimeoutError, type TokenFactorySettings } from "@/lib/ai/chat";
import { skillTrace } from "@/lib/ai/skills/prompt";
import { PROMPT_VERSION } from "@/lib/ai/config";
import type { DraftChangeSet, ReconciliationClient, ReconciliationInput } from "@/lib/ai/types";
import { buildReconciliationMessages, claimRef, passageRef } from "./prompt";
import { reconciliationAnswerSchema, reconciliationJsonSchema, type AnswerClaim, type AnswerLink } from "./schema";
import { answerToActions } from "./toDraft";

// Bound output growth for long documents without discarding any source passages. Small
// batches keep each call well inside the provider timeout; every batch is checkpointed,
// so a resume only re-reads the batches that never finished.
const MAX_BATCH_CHARS = 3000;
const MAX_BATCH_PASSAGES = 4;

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
      let answer;
      try {
        answer = await workflowStep(`extract:${passages.map((p) => p.id).join(":")}`, () => chatJson(this.settings, {
          name: "reconciliation",
          subject: input.source.title,
          schema: reconciliationAnswerSchema,
          jsonSchema: reconciliationJsonSchema,
          messages: buildReconciliationMessages({ ...input, passages }, this.settings.skills),
        }));
      } catch (error) {
        if (!(error instanceof CompletionLengthError) && !(error instanceof ProviderTimeoutError)) throw error;
        if (error instanceof CompletionLengthError) countUsage(error.tokensIn, error.tokensOut);
        // Retry only truncation and timeouts, using smaller batches; one passage is the hard stop.
        if (passages.length <= 1) throw error;
        const middle = Math.ceil(passages.length / 2);
        await extract(passages.slice(0, middle));
        await extract(passages.slice(middle));
        return;
      }
      countUsage(answer.tokensIn, answer.tokensOut);
      modelVersion = answer.model;
      const summary = answer.value.summary.trim();
      if (summary) summaries.push(summary);
      const localRefs = new Map(passages.map((passage, index) => [passageRef(index), globalRefs.get(passage.id)!]));
      // Claim refs count from 1 in every batch: shift them past the claims already collected
      const claimOffset = claims.length;
      const globalClaimRef = (ref: string) => ref.trim().replace(/^C(\d+)$/i, (_, n: string) => claimRef(claimOffset + Number(n) - 1));
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
      await extract(passages);
    }
    return {
      summary: [...new Set(summaries)].join(" ") || `Read ${input.source.title}`,
      // Convert together so entities, domains and updates to the same unit are deduplicated.
      actions: answerToActions({ summary: "", claims, links }, input),
      trace: { modelVersion, promptVersion: skillTrace(PROMPT_VERSION,["extract_knowledge","identify_entities","link_knowledge","organize_topics","define_concepts"],this.settings.skills), tokensIn, tokensOut },
    };
  }
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
