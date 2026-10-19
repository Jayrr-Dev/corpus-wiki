import { reportUploadProgress, uploadExecution, workflowStep } from "@/lib/ingest/workflowContext";
import "server-only";

import { chatJson, CompletionLengthError, type TokenFactorySettings } from "@/lib/ai/chat";
import { splitOnCutOff } from "@/lib/ai/splitOnCutOff";
import { skillTrace } from "@/lib/ai/skills/prompt";
import { PROMPT_VERSION } from "@/lib/ai/config";
import type { DraftChangeSet, ExistingEntity, PublishKnowledgeBatch, ReconciliationClient, ReconciliationInput } from "@/lib/ai/types";
import { PublishedKnowledge, publishableDraft } from "@/lib/ingest/incrementalDraft";
import { buildReconciliationMessages, claimRef, earlierClaimRef, passageRef, type EarlierComposite } from "./prompt";
import { reconciliationAnswerSchema, reconciliationJsonSchema, type AnswerClaim, type AnswerLink } from "./schema";
import { answerToActions } from "./toDraft";
import { reuseEntities, reuseFuzzyDomainPaths } from "@/lib/knowledge/nameDuplicates";
import { nameDuplicateJudge, NAME_DUPLICATE_PROMPT_VERSION } from "@/lib/ai/nameDuplicateJudge";
import { forEachLookahead } from "@/lib/processing/lookahead";
import type { ChatJsonResult } from "@/lib/ai/chat";
import type { ReconciliationAnswer } from "./schema";

// Bound output growth for long documents without discarding any source passages; every
// batch is checkpointed, so a resume only re-reads the batches that never finished.
// Measured live on a 63-passage .docx (16-passage sample): GLM-5.3-Flash at low effort read
// one 16-passage batch in 11 s, at medium each 8-passage batch took 78-168 s or timed out,
// with the same claims. Low effort keeps big batches well inside the provider timeout.
const MAX_BATCH_CHARS = 6000;
const MAX_BATCH_PASSAGES = 40;

// REAL CLIENT: cited batches can publish early; the final audited set preserves
// whole-file revisions and relationships without inserting those claims twice.
export class TokenFactoryReconciliationClient implements ReconciliationClient {
  readonly name = "token-factory";

  constructor(private readonly settings: TokenFactorySettings) {}

  async draftChangeSet(input: ReconciliationInput, publish?: PublishKnowledgeBatch): Promise<DraftChangeSet> {
    const claims: AnswerClaim[] = [];
    const links: AnswerLink[] = [];
    const summaries: string[] = [];
    const globalRefs = new Map(input.passages.map((passage, index) => [passage.id, passageRef(index)]));
    const published = new PublishedKnowledge();
    const knownEntities: ExistingEntity[] = [...input.entities];
    const entityChoices = new Map<string, ExistingEntity>();
    let modelVersion: string | null = null;
    let tokensIn: number | null = 0;
    let tokensOut: number | null = 0;
    const countUsage = (incoming: number | null, outgoing: number | null) => {
      tokensIn = tokensIn === null || incoming === null ? null : tokensIn + incoming;
      tokensOut = tokensOut === null || outgoing === null ? null : tokensOut + outgoing;
    };

    type Answer = ChatJsonResult<ReconciliationAnswer>;
    const context = () => JSON.stringify(earlierComposites(claims, links));
    const request = async (passages: ReconciliationInput["passages"], prior: string, signal?: AbortSignal): Promise<Answer> => {
      try {
        const answer = await chatJson(this.settings, {
          name: "reconciliation",
          retryInvalidOutput: true,
          subject: input.source.title,
          schema: reconciliationAnswerSchema,
          jsonSchema: reconciliationJsonSchema,
          messages: buildReconciliationMessages({ ...input, passages }, this.settings.skills, JSON.parse(prior) as EarlierComposite[]),
          // Extraction is careful reading, not puzzle solving: higher efforts only add minutes of hidden thinking
          reasoningEffort: "low",
          signal,
        });
        countUsage(answer.tokensIn, answer.tokensOut);
        return answer;
      } catch (error) {
        if (error instanceof CompletionLengthError) countUsage(error.tokensIn, error.tokensOut);
        throw error;
      }
    };
    const extract = async (passages: ReconciliationInput["passages"], prepared?: Answer): Promise<void> => {
      const answer = await workflowStep(`extract:${passages.map((p) => p.id).join(":")}`, () => prepared ? Promise.resolve(prepared) : request(passages, context()));
      modelVersion = answer.model;
      // Normalize each batch once before publication. Checkpointing these choices
      // keeps a resume's canonical identities identical to the saved units.
      const resolvedEntity = <T extends ExistingEntity>(entity: T): T => ({ ...entity, ...entityChoices.get(`${entity.type}:${entity.key}`) });
      const batchClaims = publish ? await workflowStep(`normalize-extract:${passages.map((p) => p.id).join(":")}`, () => reuseEntities(
        answer.value.claims.map((claim) => ({ ...claim, ...(input.fileTopicsLater ? { domainPaths: [] } : {}),
          entities: claim.entities.map(resolvedEntity),
          ...(claim.applicability ? { applicability: { ...claim.applicability, entities: claim.applicability.entities.map(resolvedEntity) } } : {}),
        })), knownEntities,
        nameDuplicateJudge(this.settings, "entity", { source: input.source.title,
          existingKnowledge: input.existingUnits.slice(0, 12).map((unit) => ({ content: unit.content, context: unit.context })) },
        (usage) => countUsage(usage.tokensIn, usage.tokensOut)),
      )) : answer.value.claims;
      if (publish) {
        answer.value.claims.forEach((raw, index) => {
          const normalized = batchClaims[index]!;
          const before = [...raw.entities, ...raw.applicability?.entities ?? []];
          const after = [...normalized.entities, ...normalized.applicability?.entities ?? []];
          before.forEach((entity, position) => {
            const target = after[position];
            if (target) entityChoices.set(`${entity.type}:${entity.key}`, { type: target.type, key: target.key, name: target.name });
          });
        });
        const draft = publishableDraft({ summary: answer.value.summary,
          actions: answerToActions({ ...answer.value, claims: batchClaims, links: [] }, { ...input, passages, entities: knownEntities }),
          trace: { modelVersion, promptVersion: PROMPT_VERSION, tokensIn: answer.tokensIn, tokensOut: answer.tokensOut } });
        published.remember(draft, await publish(passages.map((p) => p.id).join(":"), draft));
        for (const claim of batchClaims) for (const entity of [...claim.entities, ...claim.applicability?.entities ?? []]) {
          if (!knownEntities.some((known) => known.type === entity.type && known.key === entity.key)) knownEntities.push(entity);
        }
      }
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
      claims.push(...batchClaims.map((claim) => ({
        ...claim,
        passages: claim.passages.map((ref) => localRefs.get(ref.trim().toUpperCase()) ?? "INVALID_PASSAGE"),
      })));
    };

    // The status line counts the batches read so far (a split batch still counts once)
    const batches = passageBatches(input.passages);
    let done = 0;
    await reportUploadProgress({ step: "extraction", done, total: batches.length });
    await forEachLookahead(batches, { context, limit: publish ? 2 : 1, signal: uploadExecution.getStore()?.signal,
      read: async (passages, prior, signal) => {
        const execution = uploadExecution.getStore();
        if (execution) {
          const saved = await execution.db.call<{ done: boolean; output: Answer }>("read_completed_upload_step", {
            p_event_id: execution.eventId, p_token: execution.token, p_key: `extract:${passages.map((p) => p.id).join(":")}`,
          });
          if (saved.done) { countUsage(saved.output.tokensIn, saved.output.tokensOut); return { value: { answer: saved.output }, checkpoint: true }; }
        }
        try { return { value: { answer: await request(passages, prior, signal) } }; }
        catch (error) { return { value: { error } }; }
      },
      consume: async (passages, result: { answer?: Answer; error?: unknown }) => {
        let prepared = true;
        await splitOnCutOff(passages, async (part) => {
          if (prepared) { prepared = false; if (result.error) throw result.error; return extract(part, result.answer); }
          return extract(part);
        });
        await reportUploadProgress({ step: "extraction", done: ++done, total: batches.length });
      },
    });
    const countReview = (usage: { tokensIn: number | null; tokensOut: number | null }) => countUsage(usage.tokensIn, usage.tokensOut);
    const resolvedClaims = publish ? claims : await reuseEntities(claims, input.entities, nameDuplicateJudge(this.settings, "entity", {
      source: input.source.title, existingKnowledge: input.existingUnits.slice(0, 12).map((unit) => ({ content: unit.content, context: unit.context })),
    }, countReview));
    const domainPaths = await reuseFuzzyDomainPaths([...new Set(resolvedClaims.flatMap((claim) => claim.domainPaths))], input.domainPaths,
      nameDuplicateJudge(this.settings, "domain", { source: input.source.title, claims: resolvedClaims.slice(0, 12).map((claim) => ({ content: claim.content, entities: claim.entities })) }, countReview));
    const canonicalClaims = resolvedClaims.map((claim) => ({ ...claim, domainPaths: claim.domainPaths.map((path) => domainPaths.get(path) ?? path) }));
    const draft: DraftChangeSet = {
      summary: [...new Set(summaries)].join(" ") || `Read ${input.source.title}`,
      // Convert together so entities, domains and updates to the same unit are deduplicated.
      actions: answerToActions({ summary: "", claims: canonicalClaims, links }, input),
      trace: { modelVersion, promptVersion: skillTrace(`${PROMPT_VERSION}+${NAME_DUPLICATE_PROMPT_VERSION}`,["extract_knowledge","identify_entities","link_knowledge","organize_topics","define_concepts"],this.settings.skills), tokensIn, tokensOut },
    };
    return publish ? published.remaining(draft) : draft;
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
