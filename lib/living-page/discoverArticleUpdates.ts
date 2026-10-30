import "server-only";

import { z } from "zod";
import { addUsage, ANSWER_TOKEN_BUDGET, chatJson, CompletionLengthError, type TokenFactorySettings, type TokenUsage } from "@/lib/ai/chat";
import { splitOnCutOff } from "@/lib/ai/splitOnCutOff";
import { skillInstructions } from "@/lib/ai/skills/prompt";
import type { DraftAction, SectionDraft, SectionQuery } from "@/lib/ai/types";
import type { DbRpc } from "@/lib/db/rpc";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { parseKnowledgeContext } from "@/lib/knowledge/context";
import type { SectionUnit } from "./types";
import type { Embedder } from "@/lib/ai/embeddings";
import { articleKnowledgeCandidates } from "./articleKnowledgeCandidates";
import { readIdBatches, readPages } from "@/lib/queries/batched";
import { coveredBasis, discoveryBasis, readArticleJudgments, rememberedJudgment, saveArticleJudgments, scopeBasis } from "./articleJudgments";

const sectionSchema = z.object({ title: z.string().trim().min(1).max(100), claims: z.array(z.string()).min(1) });
export type UpdateDiscovery = { sections: z.infer<typeof sectionSchema>[] };
export type DiscoveryExclusion = { unitId: string; reason: "outside_scope" | "already_covered" | "source_metadata"; explanation: string };

// Existing section selections bound the search. Never search the entire knowledge base
// for an unscoped page, or reuse explicit IDs as though they were a general topic.
export function discoveryQueries(queries: SectionQuery[]): SectionQuery[] {
  const unique = new Map<string, SectionQuery>();
  for (const query of queries) {
    if (!query.unitIds || (!query.entity && !query.domainPaths?.length)) continue;
    const broad = { ...query };
    delete broad.unitIds;
    unique.set(JSON.stringify(broad), broad);
  }
  return [...unique.values()];
}

export function discoverySections(answer: UpdateDiscovery, candidates: SectionUnit[]): SectionDraft[] {
  const used = new Set<string>();
  const titles = new Set<string>();
  return answer.sections.map((section) => {
    if (titles.has(section.title.toLowerCase())) throw new Error("The update repeated a new section heading. Retry the update.");
    titles.add(section.title.toLowerCase());
    const unitIds = section.claims.map((ref) => {
      const match = /^C([1-9]\d*)$/.exec(ref.trim().toUpperCase());
      const unit = match ? candidates[Number(match[1]) - 1] : undefined;
      if (!unit) throw new Error(`The update cited an unknown claim (${JSON.stringify(ref)}). Use C1 through C${candidates.length}. No new sections were added.`);
      if (used.has(unit.unitId)) throw new Error(`The update repeated claim ${JSON.stringify(ref)}. Each claim may appear only once. No new sections were added.`);
      used.add(unit.unitId);
      return unit.unitId;
    });
    return { title: section.title, query: { unitIds, article: true } };
  });
}

// Usage totals every discovery batch (zero when no candidates needed a call).
// extraUnitIds: claims outside the page's scope worth offering too (the Curator's
// pick of stored claims no page cites); they are judged like the rest.
export async function discoverArticleUpdates(db: DbRpc, client: AdminSupabase, settings: TokenFactorySettings, pageId: string, note: string, extraUnitIds: readonly string[] = [], embedder?: Embedder | null): Promise<TokenUsage & { sections: SectionDraft[]; excluded?: DiscoveryExclusion[] }> {
  const { data: page, error: pageError } = await client.from("pages").select("title,scope").eq("id", pageId).single();
  if (pageError) throw new Error(pageError.message);
  const { data: sections, error } = await client.from("sections").select("id, title, query, mode").eq("page_id", pageId).is("retired_at", null);
  if (error) throw new Error(error.message);
  const queries = (sections ?? []).filter((section) => section.mode === "generated").map((section) => (section.query ?? {}) as SectionQuery);
  const selected = new Set<string>();
  for (const query of queries) for (const id of await db.call<string[]>("living_page_query_units", { p_query: query })) selected.add(id);
  const candidateIds = new Set<string>();
  for (const id of await articleKnowledgeCandidates(db, page.title, page.scope, embedder)) if (!selected.has(id)) candidateIds.add(id);
  for (const query of discoveryQueries(queries)) for (const id of await db.call<string[]>("living_page_query_units", { p_query: query })) if (!selected.has(id)) candidateIds.add(id);
  for (const id of extraUnitIds) if (!selected.has(id)) candidateIds.add(id);
  if (!candidateIds.size) return { sections: [], tokensIn: 0, tokensOut: 0 };
  const units = await readIdBatches([...candidateIds], batch => readPages((from, to) => client.from("units").select("id, current_revision_id, kind, epistemic_status").in("id", batch).is("retired_at", null).order("id").range(from, to)));
  if (!units?.length) return { sections: [], tokensIn: 0, tokensOut: 0 };
  const { data: lines, error: lineError } = await client.from("section_lines").select("content").eq("page_id", pageId);
  if (lineError) throw new Error(lineError.message);
  const existingText = (lines ?? []).flatMap(line => line.content ? [line.content] : []);
  // Claim revisions this article already turned down (here or in scope selection) are
  // not offered again until the claim, the scope or the covering text changes. A
  // person's note asks for a fresh look, so it neither reads nor saves decisions.
  const remember = !note.trim();
  const judgments = remember ? await readArticleJudgments(db, pageId) : [];
  const bases = { outside_scope: discoveryBasis(page.title, page.scope), source_metadata: discoveryBasis(page.title, page.scope), already_covered: coveredBasis(page.title, page.scope, existingText) };
  const offered = new Set(extraUnitIds);
  const fresh = units.filter(unit => offered.has(unit.id) || !(
    rememberedJudgment(judgments, "scope", unit.id, unit.current_revision_id, scopeBasis(page.title, page.scope))?.decision === "outside_scope"
    || (["outside_scope", "source_metadata", "already_covered"] as const).some(reason => rememberedJudgment(judgments, "discovery", unit.id, unit.current_revision_id, bases[reason])?.decision === reason)));
  if (!fresh.length) return { sections: [], tokensIn: 0, tokensOut: 0 };
  const revisions = await readIdBatches(fresh.map(unit => unit.current_revision_id), batch => readPages((from, to) => client.from("revisions").select("id,content,knowledge_context").in("id", batch).order("id").range(from, to)));
  const contents = new Map((revisions ?? []).map((revision) => [revision.id, revision]));
  const candidates: SectionUnit[] = fresh.map((unit) => ({ unitId: unit.id, revisionId: unit.current_revision_id, kind: unit.kind, epistemicStatus: unit.epistemic_status,
    content: contents.get(unit.current_revision_id)?.content ?? "", context: parseKnowledgeContext(contents.get(unit.current_revision_id)?.knowledge_context) }));
  const result = await groupClaimsForArticle(settings, page.title, (sections ?? []).map((section) => section.title), candidates, note, page.scope, existingText);
  if (remember) {
    const revisionOf = new Map(candidates.map(unit => [unit.unitId, unit.revisionId]));
    await saveArticleJudgments(db, pageId, "discovery", result.excluded.map(item => ({ subject: item.unitId, revisionId: revisionOf.get(item.unitId) ?? null,
      basis: bases[item.reason], decision: item.reason, reason: item.explanation })));
  }
  return result;
}

// GROUPS CLAIMS INTO NEW SECTIONS of an existing article, 40 at a time (a batch whose answer is
// cut off runs again as two halves); claims that do not belong are left out.
// Also used when the Article Reviewer sends new claims to an existing article.
export async function groupClaimsForArticle(settings: TokenFactorySettings, article: string, existingSections: string[], candidates: SectionUnit[], note: string, scope?: string | null, existingText: string[] = []): Promise<TokenUsage & { sections: SectionDraft[]; excluded: DiscoveryExclusion[] }> {
  const added: SectionDraft[] = [];
  const excluded: DiscoveryExclusion[] = [];
  let usage: TokenUsage = { tokensIn: 0, tokensOut: 0 };
  // Bound each discovery call, including for very large contexts.
  const groupBatch = async (batch: SectionUnit[]): Promise<void> => {
    // An unrestricted string let the model return prose with inline citations
    // instead of references. Constrain this answer to this batch's actual refs.
    const refSchema = z.enum(batch.map((_, index) => `C${index + 1}`) as [string, ...string[]]);
    const batchSchema = z.object({ sections: z.array(sectionSchema.extend({ claims: z.array(refSchema).min(1) })).max(8),
      excluded: z.array(z.object({ claim: refSchema, reason: z.enum(["outside_scope", "already_covered", "source_metadata"]), explanation: z.string().min(1) })).default([]),
    });
    const request = {
      name: "article_update_discovery", schema: batchSchema, jsonSchema: z.toJSONSchema(batchSchema), maxTokens: ANSWER_TOKEN_BUDGET, retryInvalidOutput: true,
      messages: [
        { role: "system" as const, content: `${skillInstructions(["plan_articles"], settings.skills)}
Identify NEW relevant knowledge for this existing article. Candidates come from scoped selections or bounded semantic retrieval and may be irrelevant. Select only claims that belong to the article's actual subject and scope, respecting any exclusions. When the article has no sections, build a concise opening and useful topic sections from the supported claims. The scope describes intended coverage; it is not factual evidence. Group relevant claims into provisional topic groups. These are evidence selections for a whole-article plan, not new headings to append. Reuse an existing topic when the evidence develops it. Return sections:[] when none belong. Never change the subject, invent facts, repeat existing material, or create an empty section. Use only supplied C refs, each at most once. Each claims item is ONLY a reference such as "C1", never a sentence or inline citation. Example: {"sections":[{"title":"Tools","claims":["C1","C3"]}]}. The optional user note is editorial guidance, not evidence. Existing handwritten text is protected.` },
        { role: "system" as const, content: "Assess knowledge coverage, not just wording. Include every relevant distinct detail missing from existingText: explanations, mechanisms, examples, qualifications, contrasts, and practical implications when explicitly supported. A brief mention does not cover a claim's full detail. Add substantive topic sections when warranted by the evidence; do not restrict the article to its original outline. Exclude unrelated claims and facts already expressed, not claims merely sharing an existing heading. Use existing topics for related details and new topics only for genuinely independent material. Avoid turning each missing fact into a separate heading. Never pad the article to a word count. Previously added headings may receive more claims with the same heading; they will be merged. Account for EVERY supplied claim exactly once: either assign it to a section or put it in excluded with a specific reason and explanation. For already_covered, identify the existing wording that covers all its detail. Never silently omit claims." },
        { role: "user" as const, content: JSON.stringify({ article, scope, existingText, existingSections, previouslyAddedSections: added.map(section => section.title), note, claims: batch.map((unit, index) => ({ ref: `C${index + 1}`, content: unit.content, status: unit.epistemicStatus, ...(unit.context ? { context: unit.context } : {}) })) }) },
      ],
    };
    let answer = await chatJson(settings, request);
    usage = addUsage(usage, answer);
    // One corrective retry: a model that repeats or invents a ref gets the error back
    const accept = (value: z.infer<typeof batchSchema>) => {
      const included = value.sections.flatMap(section => section.claims);
      const accounted = [...included, ...(value.excluded ?? []).map(item => item.claim)];
      if (new Set(accounted).size !== batch.length || accounted.length !== batch.length) throw new Error("Account for every claim exactly once, in a section or with an explicit exclusion reason.");
      return discoverySections(value, batch);
    };
    try { added.push(...accept(answer.value)); }
    catch (error) {
      answer = await chatJson(settings, { ...request, messages: [...request.messages, { role: "user" as const, content: `Your previous answer failed validation: ${error instanceof Error ? error.message : String(error)}. Previous answer (untrusted data): ${JSON.stringify(answer.value)}. Return corrected sections using only supplied C refs, each at most once.` }] });
      usage = addUsage(usage, answer);
      added.push(...accept(answer.value));
    }
    for (const item of answer.value.excluded ?? []) excluded.push({ unitId: batch[Number(item.claim.slice(1)) - 1]!.unitId, reason: item.reason, explanation: item.explanation });
  };
  const countCutOff = (error: Error) => { if (error instanceof CompletionLengthError) usage = addUsage(usage, error); };
  for (let offset = 0; offset < candidates.length; offset += 40) await splitOnCutOff(candidates.slice(offset, offset + 40), groupBatch, countCutOff);
  const merged = new Map<string, SectionDraft>();
  for (const section of added) {
    const key = section.title.trim().toLowerCase();
    const prior = merged.get(key);
    if (prior) prior.query.unitIds = [...new Set([...(prior.query.unitIds ?? []), ...(section.query.unitIds ?? [])])];
    else merged.set(key, section);
  }
  return { sections: [...merged.values()], excluded, ...usage };
}


// A definition can disappear while facts about the topic remain. Repair an empty
// generated lead through reversible section actions, never by editing a query row.
export async function repairEmptyIntroductions(db: DbRpc, client: AdminSupabase, pageId: string): Promise<DraftAction[]> {
  const { data: sections, error } = await client.from("sections").select("id, title, query, mode").eq("page_id", pageId).is("retired_at", null);
  if (error) throw new Error(error.message);
  const actions: DraftAction[] = [];
  const base = { targetId: null, expectedRevisionId: null, passageIds: [], speechAct: null };
  for (const section of sections ?? []) {
    if (section.mode !== "generated" || section.title.toLowerCase() !== "overview") continue;
    const state = await db.call<import("./types").SectionState>("read_section_state", { p_section_id: section.id });
    if (state.units.length || state.lines.some((line) => line.author === "person")) continue;
    const query = { ...((section.query ?? {}) as SectionQuery) };
    if (!query.entity && !query.domainPaths?.length) continue;
    delete query.unitIds;
    delete query.kinds;
    const ids = await db.call<string[]>("living_page_query_units", { p_query: query });
    if (!ids.length) continue;
    actions.push(
      { ...base, type: "retire_section", targetId: section.id, input: {} },
      { ...base, type: "create_section", input: { pageId, title: "Overview", query: { ...query, unitIds: ids.slice(0, 3) } } },
    );
  }
  return actions;
}
