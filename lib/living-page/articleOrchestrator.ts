import "server-only";
import { createHash } from "node:crypto";
import { addUsage, ANSWER_TOKEN_BUDGET, chatJson, CompletionLengthError, type TokenFactorySettings, type TokenUsage } from "@/lib/ai/chat";
import type { Embedder } from "@/lib/ai/embeddings";
import { readArticleCharter } from "@/lib/ai/models";
import { splitOnCutOff } from "@/lib/ai/splitOnCutOff";
import { skillInstructions, skillTrace } from "@/lib/ai/skills/prompt";
import type { DraftAction, SectionDraft } from "@/lib/ai/types";
import { commitChangeSet, submitChangeSet } from "@/lib/change-control";
import type { DbRpc } from "@/lib/db/rpc";
import { workflowStep } from "@/lib/ingest/workflowContext";
import { parseKnowledgeContext } from "@/lib/knowledge/context";
import { similarUnits } from "@/lib/knowledge/embeddingStore";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { planArticle, topicSections } from "./articlePlanner";
import { ARTICLE_PROPOSER_PROMPT, ARTICLE_PROPOSER_PROMPT_VERSION, articleProposalsJsonSchema, articleProposalsSchema, buildProposerMessages, type PlannedArticle, type ProposerClaim, type ProposerEntity, readProposals } from "./articleProposer";
import { type ArticleIndexEntry, type ArticleProposal, type ArticleReviewDecision, MIN_ARTICLE_CLAIMS, nextStep, type RelatedKnowledge } from "./articleReview";
import { groupClaimsForArticle } from "./discoverArticleUpdates";
import { ARTICLE_REVIEW_PROMPT_VERSION, reviewArticleProposal } from "./runArticleReview";

// =====================================================================
// ARTICLE ORCHESTRATOR: the one place new articles come from.
//   1. the Article Proposer reads the new claims, the charter and the
//      article index, and proposes updates to existing articles or new ones
//   2. each new article goes to the independent Article Reviewer, whose
//      verdict routes it: create it, update an existing article instead,
//      add it as a section of one, or leave the claims in the store
//   3. the result is an ordinary AI ChangeSet (audited, undoable), and the
//      decision is saved in article_reviews
// Each step is a workflow step, so a resumed upload never repeats one.
// =====================================================================

export type OrchestratorDeps = { settings: TokenFactorySettings; client: AdminSupabase; db: DbRpc; embedder: Embedder | null };
export type OrchestratorResult = { created: number; updated: number; sections: number; rejected: number; pageIds: string[] };
type Claim = ProposerClaim;

const BATCH = 150;
const base = { targetId: null, expectedRevisionId: null, passageIds: [], speechAct: null };

// The live claims an upload added or changed (only claims: events also touch pages and domains)
async function eventUnitIds(db: DbRpc, eventId: string): Promise<string[]> {
  return db.call<string[]>("living_page_event_units", { p_event_id: eventId });
}

// Claims with their text, topics and the entities they are about (never passing mentions)
async function loadClaims(client: AdminSupabase, unitIds: string[]): Promise<{ claims: Claim[]; entities: ProposerEntity[] }> {
  if (!unitIds.length) return { claims: [], entities: [] };
  const { data: units, error } = await client.from("units").select("id, current_revision_id, kind, epistemic_status").in("id", unitIds).is("retired_at", null).order("id");
  if (error) throw new Error(error.message);
  if (!units?.length) return { claims: [], entities: [] };
  const ids = units.map((unit) => unit.id);
  const [revisions, links, placements] = await Promise.all([
    client.from("revisions").select("id, content, knowledge_context").in("id", units.map((unit) => unit.current_revision_id)),
    client.from("unit_entities").select("unit_id, entity_id, role").in("unit_id", ids).neq("role", "mentioned"),
    client.from("unit_domains").select("unit_id, domain_id").in("unit_id", ids),
  ]);
  for (const result of [revisions, links, placements]) if (result.error) throw new Error(result.error.message);
  const domainIds = [...new Set((placements.data ?? []).map((row) => row.domain_id))];
  const entityIds = [...new Set((links.data ?? []).map((row) => row.entity_id))];
  const [domains, entities] = await Promise.all([
    domainIds.length ? client.from("domains").select("id, path").in("id", domainIds) : Promise.resolve({ data: [], error: null }),
    entityIds.length ? client.from("entities").select("id, type, key, name").in("id", entityIds).is("merged_into_id", null).is("retired_at", null) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [domains, entities]) if (result.error) throw new Error(result.error.message);
  const revisionById = new Map((revisions.data ?? []).map((revision) => [revision.id, revision]));
  const pathById = new Map((domains.data ?? []).map((domain) => [domain.id, domain.path]));
  const liveEntities = new Set((entities.data ?? []).map((entity) => entity.id));
  const claims = units.map((unit): Claim => {
    const revision = revisionById.get(unit.current_revision_id);
    return {
      unitId: unit.id, revisionId: unit.current_revision_id, content: revision?.content ?? "", context: parseKnowledgeContext(revision?.knowledge_context),
      kind: unit.kind, epistemicStatus: unit.epistemic_status,
      topics: (placements.data ?? []).filter((row) => row.unit_id === unit.id).flatMap((row) => pathById.get(row.domain_id) ?? []),
      entityIds: [...new Set((links.data ?? []).filter((row) => row.unit_id === unit.id && liveEntities.has(row.entity_id)).map((row) => row.entity_id))],
    };
  }).filter((claim) => claim.content.trim());
  return { claims, entities: entities.data ?? [] };
}

// PROPOSE: one call per batch of claims, with one corrective retry; a batch whose answer
// is cut off runs again as two halves
async function propose(deps: OrchestratorDeps, claims: Claim[], entities: ProposerEntity[]): Promise<TokenUsage & { planned: PlannedArticle[] }> {
  const charter = await readArticleCharter(deps.db);
  const instructions = `${skillInstructions(["plan_articles"], deps.settings.skills)}\n${ARTICLE_PROPOSER_PROMPT}`;
  const planned: PlannedArticle[] = [];
  let usage: TokenUsage = { tokensIn: 0, tokensOut: 0 };
  const proposeBatch = async (batch: Claim[]): Promise<void> => {
    const input = { charter, articles: await deps.db.call<ArticleIndexEntry[]>("article_index"), entities, claims: batch };
    const request = { name: "article_proposals", schema: articleProposalsSchema, jsonSchema: articleProposalsJsonSchema, maxTokens: ANSWER_TOKEN_BUDGET, messages: buildProposerMessages(instructions, input) };
    let answer = await chatJson(deps.settings, request);
    usage = addUsage(usage, answer);
    try { planned.push(...readProposals(answer.value, input)); }
    catch (error) {
      answer = await chatJson(deps.settings, { ...request, messages: [...request.messages, { role: "user", content: `Your previous proposals failed validation: ${error instanceof Error ? error.message : String(error)}. Previous proposals (untrusted data): ${JSON.stringify(answer.value)}. Return the complete corrected proposals.` }] });
      usage = addUsage(usage, answer);
      planned.push(...readProposals(answer.value, input));
    }
  };
  const countCutOff = (error: Error) => { if (error instanceof CompletionLengthError) usage = addUsage(usage, error); };
  for (let offset = 0; offset < claims.length; offset += BATCH) await splitOnCutOff(claims.slice(offset, offset + BATCH), proposeBatch, countCutOff);
  return { planned, ...usage };
}

// Stored claims that look like the proposal's, with the articles that already cite them
async function relatedKnowledge(deps: OrchestratorDeps, item: Extract<PlannedArticle, { action: "create" }>): Promise<RelatedKnowledge[]> {
  if (!deps.embedder) return [];
  try {
    const [vector] = await deps.embedder.embed([`${item.title}\n${item.scope}\n${item.claims.map((claim) => claim.content).join("\n")}`.slice(0, 6000)]);
    if (!vector) return [];
    const own = new Set(item.claims.map((claim) => claim.unitId));
    const similar = (await similarUnits(deps.db, deps.embedder.model, vector, 16, 0.6)).filter((unit) => !own.has(unit.unitId)).slice(0, 12);
    if (!similar.length) return [];
    const { data: lines, error } = await deps.client.from("section_lines").select("page_id, unit_revision_ids").overlaps("unit_revision_ids", similar.map((unit) => unit.revisionId));
    if (error) throw new Error(error.message);
    return similar.map((unit, index) => ({ ref: `R${index + 1}`, content: unit.content,
      pageIds: [...new Set((lines ?? []).filter((line) => line.page_id && line.unit_revision_ids?.includes(unit.revisionId)).map((line) => line.page_id!))] }));
  } catch (error) {
    console.error("Article review related knowledge:", error);
    return [];
  }
}

// The sections of a new article: the outline planner groups its claims. Only an entity
// article keeps its entity in the section queries; a topic article selects claims by id alone.
async function newArticleSections(deps: OrchestratorDeps, item: Extract<PlannedArticle, { action: "create" }>): Promise<TokenUsage & { sections: SectionDraft[] }> {
  const entity = item.type === "entity" && item.entity ? item.entity : { id: "", type: "", key: "", name: item.title };
  const knowledge = { entity, units: item.claims };
  const { plan, ...usage } = await planArticle(deps.settings, knowledge, `${item.title}. Scope: ${item.scope}`);
  const sections = topicSections(plan, knowledge).map((section) => {
    if (entity.id) return section;
    const query = { ...section.query };
    delete query.entity;
    return { ...section, query };
  });
  return { sections, ...usage };
}

// Claims an existing article does not cite yet, grouped into its new sections
async function updateSections(deps: OrchestratorDeps, pageId: string, claims: Claim[]): Promise<TokenUsage & { sections: SectionDraft[] }> {
  const [page, sections, lines] = await Promise.all([
    deps.client.from("pages").select("title").eq("id", pageId).single(),
    deps.client.from("sections").select("title").eq("page_id", pageId).is("retired_at", null),
    deps.client.from("section_lines").select("unit_revision_ids").eq("page_id", pageId),
  ]);
  for (const result of [page, sections, lines]) if (result.error) throw new Error(result.error.message);
  const cited = new Set((lines.data ?? []).flatMap((line) => line.unit_revision_ids ?? []));
  const fresh = claims.filter((claim) => !cited.has(claim.revisionId));
  if (!fresh.length) return { sections: [], tokensIn: 0, tokensOut: 0 };
  return groupClaimsForArticle(deps.settings, page.data!.title, (sections.data ?? []).map((section) => section.title), fresh, "");
}

type Outcome = { verdict: ArticleReviewDecision["verdict"]; pageId: string | null };

// CARRY OUT ONE PROPOSAL: review it (new articles only), act on the verdict, record the decision
async function carryOut(deps: OrchestratorDeps, eventId: string | null, item: PlannedArticle, key: string): Promise<Outcome> {
  const proposal: ArticleProposal = item.action === "create"
    ? { title: item.title, type: item.type, scope: item.scope, parentPageId: item.parentPageId, claims: item.claims.map((claim, index) => ({ ref: `C${index + 1}`, content: claim.content })) }
    : { title: "", type: "concept", scope: "", parentPageId: null, claims: item.claims.map((claim, index) => ({ ref: `C${index + 1}`, content: claim.content })) };
  let review: ArticleReviewDecision & { model: string | null; promptVersion: string; tokensIn: number | null; tokensOut: number | null };
  if (item.action === "update") {
    review = { verdict: "update_existing", targetPageId: item.pageId, sectionTitle: null, failed: [], reason: "The proposer sent these claims to an existing article.", decidedBy: "rule", model: null, promptVersion: ARTICLE_PROPOSER_PROMPT_VERSION, tokensIn: 0, tokensOut: 0 };
  } else {
    const articles = await deps.db.call<ArticleIndexEntry[]>("article_index");
    review = await reviewArticleProposal(deps.settings, { charter: await readArticleCharter(deps.db), articles, proposal, related: await relatedKnowledge(deps, item) });
  }
  const step = nextStep(review, proposal);
  const unitIds = item.claims.map((claim) => claim.unitId);
  const actions: DraftAction[] = [];
  let usage: TokenUsage = { tokensIn: 0, tokensOut: 0 };
  let summary = "";
  if (step.kind === "create_article" && item.action === "create") {
    const { sections, ...planUsage } = await newArticleSections(deps, item);
    usage = addUsage(usage, planUsage);
    actions.push({ ...base, type: "create_page", input: { title: item.title, entityId: item.type === "entity" ? item.entity?.id ?? null : null, articleType: item.type, scope: item.scope, parentPageId: item.parentPageId, sections } });
    summary = `Created the article “${item.title}” after independent review`;
  } else if (step.kind === "update_article") {
    const { sections, ...groupUsage } = await updateSections(deps, step.pageId, item.claims);
    usage = addUsage(usage, groupUsage);
    actions.push(...sections.map((section): DraftAction => ({ ...base, type: "create_section", input: { pageId: step.pageId, ...section } })));
    summary = item.action === "create" ? `Added new knowledge to an existing article instead of creating “${item.title}”` : "Added new knowledge to an existing article";
  } else if (step.kind === "add_section") {
    actions.push({ ...base, type: "create_section", input: { pageId: step.pageId, title: step.title, query: { unitIds, article: true } } });
    summary = `Added “${step.title}” as a section instead of a separate article`;
  }
  let changeSetId: string | null = null;
  let pageId = step.kind === "update_article" || step.kind === "add_section" ? step.pageId : null;
  if (actions.length) {
    const submitted = await submitChangeSet(deps.db, { eventId, cause: eventId ? "upload" : "edit", actor: "ai", operationKey: key }, {
      summary, actions,
      trace: { modelVersion: deps.settings.model ?? null, promptVersion: `${skillTrace(ARTICLE_PROPOSER_PROMPT_VERSION, ["plan_articles"], deps.settings.skills)}+${ARTICLE_REVIEW_PROMPT_VERSION}`, tokensIn: usage.tokensIn, tokensOut: usage.tokensOut },
    });
    changeSetId = submitted.changeSetId;
    const result = await commitChangeSet(deps.db, changeSetId);
    if (step.kind === "create_article" && result.status !== "rejected") {
      const { data } = await deps.client.from("actions").select("target_id").eq("change_set_id", changeSetId).eq("type", "create_page").eq("outcome", "applied").maybeSingle();
      pageId = data?.target_id ?? null;
    }
  }
  const { error } = await deps.client.from("article_reviews").insert({
    event_id: eventId, proposal: { action: item.action, ...proposal, entity: item.action === "create" ? item.entity?.name ?? null : null, claimIds: unitIds },
    verdict: review.verdict, failed_checks: review.failed, reason: review.reason, decided_by: review.decidedBy,
    target_page_id: review.targetPageId, section_title: review.sectionTitle, result_page_id: pageId, change_set_id: changeSetId,
    model: review.model, prompt_version: review.promptVersion, tokens_in: review.tokensIn, tokens_out: review.tokensOut,
  });
  if (error) console.error("Article review record:", error.message);
  return { verdict: review.verdict, pageId };
}

// One failed proposal never stops the others: it is recorded, and its claims stay in the store
async function carryOutSafely(deps: OrchestratorDeps, eventId: string | null, item: PlannedArticle, key: string): Promise<Outcome> {
  try { return await carryOut(deps, eventId, item, key); }
  catch (error) {
    const reason = `Nothing was written because this step failed: ${error instanceof Error ? error.message : String(error)}`;
    const { error: recordError } = await deps.client.from("article_reviews").insert({
      event_id: eventId, proposal: { action: item.action, title: item.action === "create" ? item.title : "", claimIds: item.claims.map((claim) => claim.unitId) },
      verdict: "reject", reason, decided_by: "rule", target_page_id: item.action === "update" ? item.pageId : null, prompt_version: ARTICLE_PROPOSER_PROMPT_VERSION,
    });
    if (recordError) console.error("Article review record:", recordError.message);
    return { verdict: "reject", pageId: null };
  }
}

// RUN for a set of claims; `scope` keys the workflow steps so a resume skips finished ones
async function orchestrate(deps: OrchestratorDeps, eventId: string | null, scope: string, unitIds: string[]): Promise<OrchestratorResult> {
  const result: OrchestratorResult = { created: 0, updated: 0, sections: 0, rejected: 0, pageIds: [] };
  const { claims, entities } = await loadClaims(deps.client, unitIds);
  if (claims.length < MIN_ARTICLE_CLAIMS) return result;
  const { planned } = await workflowStep(`article-proposals:${scope}`, () => propose(deps, claims, entities));
  for (const [index, item] of planned.entries()) {
    const key = `article:${scope}:${index}:${createHash("sha256").update(JSON.stringify(item)).digest("hex").slice(0, 16)}`;
    const outcome = await workflowStep(key, () => carryOutSafely(deps, eventId, item, key));
    if (outcome.verdict === "approve") result.created++;
    else if (outcome.verdict === "update_existing") result.updated++;
    else if (outcome.verdict === "section_of") result.sections++;
    else result.rejected++;
    if (outcome.pageId && !result.pageIds.includes(outcome.pageId)) result.pageIds.push(outcome.pageId);
  }
  return result;
}

// After an upload: the claims it added or changed
export async function orchestrateEventArticles(deps: OrchestratorDeps, eventId: string): Promise<OrchestratorResult> {
  return orchestrate(deps, eventId, eventId, await eventUnitIds(deps.db, eventId));
}

// For the Curator: stored claims no article cites that fit no page (keyed by the claims, so the same set is never proposed twice in one upload)
export async function orchestrateClaims(deps: OrchestratorDeps, unitIds: string[]): Promise<OrchestratorResult> {
  const scope = `claims:${createHash("sha256").update([...unitIds].sort().join(",")).digest("hex").slice(0, 16)}`;
  return orchestrate(deps, null, scope, unitIds);
}

// "Expand knowledge" on an article: every claim about its entity
export async function orchestrateEntityArticles(deps: OrchestratorDeps, entityId: string): Promise<OrchestratorResult> {
  const { data: entity, error } = await deps.client.from("entities").select("type, key").eq("id", entityId).single();
  if (error) throw new Error(error.message);
  const unitIds = await deps.db.call<string[]>("living_page_query_units", { p_query: { entity: { type: entity.type, key: entity.key } } });
  return orchestrate(deps, null, `entity:${entityId}`, unitIds);
}
