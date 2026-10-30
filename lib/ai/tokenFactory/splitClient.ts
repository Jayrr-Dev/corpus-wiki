import "server-only";
import { createHash } from "node:crypto";

import { chatJson, CompletionLengthError, type ChatJsonResult, type TokenFactorySettings } from "@/lib/ai/chat";
import { PROMPT_VERSION } from "@/lib/ai/config";
import { nameDuplicateJudge, NAME_DUPLICATE_PROMPT_VERSION } from "@/lib/ai/nameDuplicateJudge";
import { skillTrace } from "@/lib/ai/skills/prompt";
import type { DraftChangeSet, ExistingEntity, ExistingUnit, PublishKnowledgeBatch, ReconciliationClient, ReconciliationInput } from "@/lib/ai/types";
import type { DbRpc } from "@/lib/db/rpc";
import { PublishedKnowledge, publishableDraft } from "@/lib/ingest/incrementalDraft";
import { reportUploadProgress, uploadExecution, workflowStep } from "@/lib/ingest/workflowContext";
import { claimEmbeddingText, draftTextContext } from "@/lib/knowledge/claimEmbeddingText";
import { reuseEntities, reuseFuzzyDomainPaths } from "@/lib/knowledge/nameDuplicates";
import { mapConcurrent } from "@/lib/processing/concurrency";
import { splitOnCutOff } from "@/lib/ai/splitOnCutOff";
import { passageBatches } from "./client";
import { pickNeighborhood, SIMILAR_LIMIT, type NeighborhoodStore, type UploadClaim } from "./neighborhood";
import { buildReconciliationMessages, claimRef, passageRef, unitRef } from "./prompt";
import { buildResolutionMessages, resolutionAnswerSchema, resolutionJsonSchema, resolveGroup, RESOLUTION_PROMPT_VERSION, type ResolutionAnswer, type ResolutionGroup } from "./resolution";
import { reconciliationAnswerSchema, reconciliationJsonSchema, type AnswerClaim, type AnswerLink, type ReconciliationAnswer } from "./schema";
import { answerToActions } from "./toDraft";

// =====================================================================
// SPLIT RECONCILIATION CLIENT (issue #45), chosen with RECONCILE_CLIENT=split.
// Two stages instead of one call that reads the file against the store:
//   1. extraction  each batch of passages becomes draft claims without
//                  the store in the prompt; batches run in parallel and
//                  are cached by their text and the prompt version
//   2. resolution  each draft claim is compared with its neighborhood
//                  (lib/ai/tokenFactory/neighborhood.ts), a few claims per
//                  call, and becomes an add, a revision, a retirement or
//                  more evidence for a claim already known
// The answer claims and links are the same shapes the current client
// builds, so toDraft, publishing and Change control are unchanged.
// =====================================================================

export const EXTRACTION_PROMPT_VERSION = `${PROMPT_VERSION}+extract-v1`;
const EXTRACT_CONCURRENCY = 4;
const RESOLVE_GROUP = 8;
const RESOLVE_CONCURRENCY = 3;
const SEARCH_CONCURRENCY = 8;
// How many neighbors the entity duplicate judge reads (the old context was the 12 oldest claims)
const JUDGE_CONTEXT = 12;
const SKILL_STAGES = ["extract_knowledge", "identify_entities", "link_knowledge", "organize_topics", "define_concepts"] as const;

type Answer = ChatJsonResult<ReconciliationAnswer>;

// EXTRACTION ANSWERS BY TEXT: the same passages read with the same prompt and model give the same draft
export type ExtractionCache = { read(key: string): Promise<Answer | null>; save(key: string, answer: Answer): Promise<void> };

export function dbExtractionCache(db: DbRpc): ExtractionCache {
  return {
    read: (key) => db.call<Answer | null>("read_extraction_cache", { p_key: key }),
    save: async (key, answer) => { await db.call("save_extraction_cache", { p_key: key, p_answer: answer }); },
  };
}

// What the client reads besides its input; null without a database (word overlap and the input's claims only)
export type SplitPorts = { store: NeighborhoodStore; cache: ExtractionCache | null };

// ONE READ PART OF THE FILE: a batch, or half of one when the answer was cut off
type Part = { passages: ReconciliationInput["passages"]; answer: Answer };

export class SplitReconciliationClient implements ReconciliationClient {
  readonly name = "token-factory-split";
  readonly readsNeighborhood = true;

  constructor(private readonly settings: TokenFactorySettings, private readonly ports: () => SplitPorts | null = () => null) {}

  async draftChangeSet(input: ReconciliationInput, publish?: PublishKnowledgeBatch): Promise<DraftChangeSet> {
    const ports = this.ports();
    const signal = uploadExecution.getStore()?.signal;
    let modelVersion: string | null = null;
    let tokensIn: number | null = 0;
    let tokensOut: number | null = 0;
    const countUsage = (incoming: number | null, outgoing: number | null) => {
      tokensIn = tokensIn === null || incoming === null ? null : tokensIn + incoming;
      tokensOut = tokensOut === null || outgoing === null ? null : tokensOut + outgoing;
    };

    // 1. EXTRACTION: every batch at once, each from its checkpoint, the cache or the model
    const batches = passageBatches(input.passages);
    let read = 0;
    await reportUploadProgress({ step: "extraction", done: read, total: batches.length });
    const parts = (await mapConcurrent(batches, EXTRACT_CONCURRENCY, async (passages) => {
      const found: Part[] = [];
      await splitOnCutOff(passages, async (part) => { found.push({ passages: part, answer: await this.extract(input, part, ports?.cache ?? null, countUsage, signal) }); });
      await reportUploadProgress({ step: "extraction", done: ++read, total: batches.length });
      return found;
    }, signal)).flat();

    // 2. RESOLUTION: part by part, so each part sees the claims of the parts before it
    const globalRefs = new Map(input.passages.map((passage, index) => [passage.id, passageRef(index)]));
    const units: ExistingUnit[] = [...input.existingUnits];
    const unitIndex = new Map(units.map((unit, index) => [unit.unitId, index]));
    const stored = new Map(units.map((unit) => [unit.unitId, unit]));
    const knownEntities: ExistingEntity[] = [...input.entities];
    const entityChoices = new Map<string, ExistingEntity>();
    // Every claim the file states, by its place in the file; null once merged into an earlier one
    const claims: (AnswerClaim | null)[] = [];
    const vectors: (number[] | null)[] = [];
    const sameAs = new Map<number, number>();
    const links: AnswerLink[] = [];
    const summaries: string[] = [];
    const partRanges: { key: string; start: number; end: number }[] = [];
    const root = (index: number): number => sameAs.has(index) ? root(sameAs.get(index)!) : index;

    for (const part of parts) {
      modelVersion = part.answer.model;
      const key = part.passages.map((passage) => passage.id).join(":");
      const start = claims.length;
      const localRefs = new Map(part.passages.map((passage, index) => [passageRef(index), globalRefs.get(passage.id)!]));
      const drafted = part.answer.value.claims.map((claim) => ({ ...claim, action: "add" as const, unit: null,
        ...(input.fileTopicsLater ? { domainPaths: [] } : {}),
        passages: claim.passages.map((ref) => localRefs.get(ref.trim().toUpperCase()) ?? "INVALID_PASSAGE") }));
      const summary = part.answer.value.summary.trim();
      if (summary) summaries.push(summary);

      // Vectors and the nearest stored claims of each draft, embedded as stored claims are (with their context)
      const partVectors = await this.embed(ports, drafted.map((claim) => claimEmbeddingText(claim.content, draftTextContext(claim.entities, claim.applicability))));
      const similar = ports && partVectors
        ? await mapConcurrent(partVectors, SEARCH_CONCURRENCY, (vector) => ports.store.similar(vector, SIMILAR_LIMIT), signal)
        : drafted.map(() => []);
      const missing = [...new Set(similar.flat().map((row) => row.unitId).filter((id) => !stored.has(id)))];
      if (ports && missing.length) for (const unit of await ports.store.units(missing)) {
        if (stored.has(unit.unitId)) continue;
        unitIndex.set(unit.unitId, units.length);
        units.push(unit);
        stored.set(unit.unitId, unit);
      }

      // Entities: the same key always maps to the same entity; the judge reads the nearest claims, most alike first
      const nearest = [...new Map(similar.flat().sort((a, b) => b.similarity - a.similarity).flatMap((row) => {
        const unit = stored.get(row.unitId);
        return unit ? [[unit.unitId, { content: unit.content, context: unit.context }] as const] : [];
      })).values()].slice(0, JUDGE_CONTEXT);
      const normalized = await workflowStep(`split-normalize:${key}`, () => reuseEntities(drafted.map((claim) => this.chosen(claim, entityChoices)), knownEntities,
        nameDuplicateJudge(this.settings, "entity", { source: input.source.title, existingKnowledge: nearest }, (usage) => countUsage(usage.tokensIn, usage.tokensOut))));
      drafted.forEach((raw, index) => {
        const before = [...raw.entities, ...raw.applicability?.entities ?? []];
        const after = [...normalized[index]!.entities, ...normalized[index]!.applicability?.entities ?? []];
        before.forEach((entity, position) => {
          const target = after[position];
          if (target) entityChoices.set(`${entity.type}:${entity.key}`, { type: target.type, key: target.key, name: target.name });
        });
      });
      for (const claim of normalized) for (const entity of [...claim.entities, ...claim.applicability?.entities ?? []]) {
        if (!knownEntities.some((known) => known.type === entity.type && known.key === entity.key)) knownEntities.push(entity);
      }

      // The extraction's own links, counted across the file
      links.push(...part.answer.value.links.flatMap((link) => {
        const from = /^C(\d+)$/i.exec(link.from.trim()), to = /^C(\d+)$/i.exec(link.to.trim());
        return from && to ? [{ ...link, from: claimRef(start + Number(from[1]) - 1), to: claimRef(start + Number(to[1]) - 1) }] : [];
      }));

      // Each draft's neighborhood; a draft with none is new without asking
      const earlier: UploadClaim[] = claims.flatMap((claim, index) => claim ? [{ index, claim, vector: vectors[index] ?? null }] : []);
      const partOfPositions = new Map<number, number>();
      for (const link of links) if (link.type === "part_of") {
        const to = /^C(\d+)$/.exec(link.to);
        if (to) partOfPositions.set(root(Number(to[1]) - 1), Math.max(partOfPositions.get(root(Number(to[1]) - 1)) ?? 0, link.position ?? 0));
      }
      const withNeighbors = normalized.map((claim, offset) => ({ index: start + offset, claim,
        neighbors: pickNeighborhood(claim, partVectors?.[offset] ?? null, similar[offset] ?? [], stored, earlier) }));
      claims.push(...normalized);
      vectors.push(...normalized.map((_, offset) => partVectors?.[offset] ?? null));
      const groups: ResolutionGroup[] = [];
      const asking = withNeighbors.filter((row) => row.neighbors.length);
      for (let at = 0; at < asking.length; at += RESOLVE_GROUP) groups.push({ claims: asking.slice(at, at + RESOLVE_GROUP) });
      const resolved = await mapConcurrent(groups, RESOLVE_CONCURRENCY, async (group) => {
        const answer = await this.resolve(input, group, partOfPositions, countUsage, signal);
        return resolveGroup(group, answer, (unit) => unitRef(unitIndex.get(unit.unitId)!), claimRef);
      }, signal);
      for (const group of resolved) {
        links.push(...group.links);
        for (const row of group.claims) {
          if ("claim" in row) { claims[row.index] = row.claim; continue; }
          // More evidence for a claim read earlier in the file: cite it there instead of adding it twice
          const target = root(row.sameAs);
          const kept = claims[target];
          if (!kept) continue;
          claims[target] = { ...kept, passages: [...new Set([...kept.passages, ...claims[row.index]!.passages])] };
          claims[row.index] = null;
          sameAs.set(row.index, target);
        }
      }
      partRanges.push({ key, start, end: claims.length });
    }

    // Claims in file order without the merged ones, and links renumbered to match
    const position = new Map<number, number>();
    const finalClaims = claims.flatMap((claim, index) => claim ? (position.set(index, position.size), [claim]) : []);
    const renumber = (ref: string) => {
      const match = /^C(\d+)$/.exec(ref);
      if (!match) return ref;
      const index = position.get(root(Number(match[1]) - 1));
      return index === undefined ? null : claimRef(index);
    };
    const finalLinks = links.flatMap((link) => {
      const from = renumber(link.from), to = renumber(link.to);
      return from && to && from !== to ? [{ ...link, from, to }] : [];
    });
    const resolvedInput: ReconciliationInput = { ...input, existingUnits: units };

    // Publish each part's new claims (after every part is resolved, so a later merge never changes a saved claim)
    const published = new PublishedKnowledge();
    if (publish) {
      const seen: ExistingEntity[] = [...input.entities];
      for (const range of partRanges) {
        const partClaims = claims.slice(range.start, range.end).filter((claim): claim is AnswerClaim => Boolean(claim));
        const draft = publishableDraft({ summary: "", actions: answerToActions({ summary: "", claims: partClaims, links: [] }, { ...resolvedInput, entities: seen }),
          trace: { modelVersion, promptVersion: EXTRACTION_PROMPT_VERSION, tokensIn: null, tokensOut: null } });
        published.remember(draft, await publish(range.key, draft));
        for (const claim of partClaims) for (const entity of [...claim.entities, ...claim.applicability?.entities ?? []]) {
          if (!seen.some((known) => known.type === entity.type && known.key === entity.key)) seen.push(entity);
        }
      }
    }

    const countReview = (usage: { tokensIn: number | null; tokensOut: number | null }) => countUsage(usage.tokensIn, usage.tokensOut);
    const domainPaths = await reuseFuzzyDomainPaths([...new Set(finalClaims.flatMap((claim) => claim.domainPaths))], input.domainPaths,
      nameDuplicateJudge(this.settings, "domain", { source: input.source.title, claims: finalClaims.slice(0, 12).map((claim) => ({ content: claim.content, entities: claim.entities })) }, countReview));
    const canonicalClaims = finalClaims.map((claim) => ({ ...claim, domainPaths: claim.domainPaths.map((path) => domainPaths.get(path) ?? path) }));
    const draft: DraftChangeSet = {
      summary: [...new Set(summaries)].join(" ") || `Read ${input.source.title}`,
      actions: answerToActions({ summary: "", claims: canonicalClaims, links: finalLinks }, resolvedInput),
      trace: { modelVersion, promptVersion: skillTrace(`${EXTRACTION_PROMPT_VERSION}+${RESOLUTION_PROMPT_VERSION}+${NAME_DUPLICATE_PROMPT_VERSION}`, SKILL_STAGES, this.settings.skills), tokensIn, tokensOut },
    };
    return publish ? published.remaining(draft) : draft;
  }

  // ONE EXTRACTION: the upload's checkpoint, else the cache, else the model (then cached)
  private async extract(input: ReconciliationInput, passages: ReconciliationInput["passages"], cache: ExtractionCache | null,
    countUsage: (incoming: number | null, outgoing: number | null) => void, signal?: AbortSignal): Promise<Answer> {
    const messages = buildReconciliationMessages({ ...input, passages, existingUnits: [], entities: [] }, this.settings.skills);
    const key = extractionCacheKey(this.settings, input, passages);
    // spent: the model was called for this answer (a cache hit costs nothing); counted again on resume, like the current client
    const { answer, spent } = await workflowStep(`split-extract:${passages.map((passage) => passage.id).join(":")}`, async () => {
      const cached = await cache?.read(key);
      if (cached) return { answer: cached, spent: false };
      try {
        const answer = await chatJson(this.settings, {
          name: "reconciliation", retryInvalidOutput: true, subject: input.source.title,
          schema: reconciliationAnswerSchema, jsonSchema: reconciliationJsonSchema, messages, reasoningEffort: "low", signal,
        });
        await cache?.save(key, answer);
        return { answer, spent: true };
      } catch (error) {
        if (error instanceof CompletionLengthError) countUsage(error.tokensIn, error.tokensOut);
        throw error;
      }
    });
    if (spent) countUsage(answer.tokensIn, answer.tokensOut);
    return answer;
  }

  // ONE RESOLUTION CALL for a group of drafts, checkpointed by its prompt
  private async resolve(input: ReconciliationInput, group: ResolutionGroup, partOfPositions: ReadonlyMap<number, number>,
    countUsage: (incoming: number | null, outgoing: number | null) => void, signal?: AbortSignal): Promise<ResolutionAnswer> {
    const messages = buildResolutionMessages(input, group, partOfPositions);
    const hash = createHash("sha256").update(JSON.stringify(messages)).digest("hex").slice(0, 40);
    const answer = await workflowStep(`resolve:${hash}`, () => chatJson(this.settings, {
      name: "reconciliation_resolution", retryInvalidOutput: true, subject: input.source.title,
      schema: resolutionAnswerSchema, jsonSchema: resolutionJsonSchema, messages, reasoningEffort: "low", signal,
    }));
    countUsage(answer.tokensIn, answer.tokensOut);
    return answer.value;
  }

  // Draft vectors, or none: a failed embedding only narrows the neighborhood to shared entities and words
  private async embed(ports: SplitPorts | null, texts: string[]): Promise<number[][] | null> {
    if (!ports || !texts.length) return null;
    try { return await ports.store.embed(texts); }
    catch (error) {
      uploadExecution.getStore()?.signal?.throwIfAborted();
      console.error("Draft claims could not be embedded; resolving by shared entities and words:", error);
      return null;
    }
  }

  // A claim with the entity choices earlier parts already made
  private chosen(claim: AnswerClaim, choices: ReadonlyMap<string, ExistingEntity>): AnswerClaim {
    const entity = <T extends ExistingEntity>(ref: T): T => ({ ...ref, ...choices.get(`${ref.type}:${ref.key}`) });
    const end = <T extends { type: string; key: string }>(ref: T): T => {
      const choice = choices.get(`${ref.type}:${ref.key}`);
      return choice ? { ...ref, type: choice.type, key: choice.key } : ref;
    };
    return { ...claim, entities: claim.entities.map(entity),
      ...(claim.applicability ? { applicability: { ...claim.applicability, entities: claim.applicability.entities.map(entity) } } : {}),
      ...(claim.stakeholderLinks ? { stakeholderLinks: claim.stakeholderLinks.map((label) => ({ ...label, from: end(label.from), to: end(label.to) })) } : {}) };
  }
}

// THE CACHE KEY: the prompt version and skills, the model, what the prompt says about the file, and the passages' text
export function extractionCacheKey(settings: TokenFactorySettings, input: ReconciliationInput, passages: ReconciliationInput["passages"]): string {
  const text = {
    version: skillTrace(EXTRACTION_PROMPT_VERSION, SKILL_STAGES, settings.skills), model: settings.model ?? null,
    file: { title: input.source.title, date: input.source.sourceDate.slice(0, 10) },
    topicsLater: input.fileTopicsLater ?? false, externalScope: input.externalScope ?? null,
    domains: input.fileTopicsLater ? null : { paths: input.domainPaths, tabs: input.domainTabs ?? null },
    passages: passages.map((passage) => [createHash("sha256").update(passage.text).digest("hex"), passage.speakerLabel]),
  };
  return `extract:${createHash("sha256").update(JSON.stringify(text)).digest("hex")}`;
}
