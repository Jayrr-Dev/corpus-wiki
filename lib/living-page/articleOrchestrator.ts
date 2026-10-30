import { addUsage, ANSWER_TOKEN_BUDGET, chatJson, CompletionLengthError, type TokenFactorySettings, type TokenUsage } from "@/lib/ai/chat";
import type { Embedder } from "@/lib/ai/embeddings";
import { readArticleCharter } from "@/lib/ai/models";
import { skillInstructions, skillTrace } from "@/lib/ai/skills/prompt";
import { splitOnCutOff } from "@/lib/ai/splitOnCutOff";
import type { DraftAction, SectionDraft } from "@/lib/ai/types";
import { commitChangeSet, submitChangeSet } from "@/lib/change-control";
import type { DbRpc } from "@/lib/db/rpc";
import { reportUploadProgress, uploadExecution, workflowStep } from "@/lib/ingest/workflowContext";
import { parseKnowledgeContext } from "@/lib/knowledge/context";
import { similarUnits } from "@/lib/knowledge/embeddingStore";
import { readIdBatches, readPages } from "@/lib/queries/batched";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { createHash } from "node:crypto";
import "server-only";
import { articleKnowledgeCandidates } from "./articleKnowledgeCandidates";
import { planArticle, topicSections } from "./articlePlanner";
import { ARTICLE_PROPOSER_PROMPT, ARTICLE_PROPOSER_PROMPT_VERSION, articleProposalsJsonSchema, articleProposalsSchema, buildProposerMessages, type PlannedArticle, type ProposerClaim, type ProposerEntity, readProposals } from "./articleProposer";
import { type ArticleIndexEntry, type ArticleProposal, type ArticleReviewDecision, nextStep, type RelatedKnowledge } from "./articleReview";
import { articleAdditionActions } from "./articleScaffold";
import { readArticleStructure, saveArticleStructure } from "./articleStructureMemory";
import { groupClaimsForArticle } from "./discoverArticleUpdates";
import { OUTLINE_POLICY_VERSION, OutlineRejectedError } from "./outlineBuilder";
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
export async function loadArticleClaims(client: AdminSupabase, unitIds: string[]): Promise<{ claims: Claim[]; entities: ProposerEntity[] }> {
  if (!unitIds.length) return { claims: [], entities: [] };
  const units = await readIdBatches(unitIds, (batch) => readPages((from,to) => client.from("units").select("id, current_revision_id, kind, epistemic_status").in("id", batch).is("retired_at", null).order("id").range(from,to)));
  units.sort((a,b)=>a.id.localeCompare(b.id));
  if (!units.length) return { claims: [], entities: [] };
  const ids = units.map((unit) => unit.id);
  const [revisions, links, placements] = await Promise.all([
    readIdBatches(units.map((unit) => unit.current_revision_id), (batch) => readPages((from,to)=>client.from("revisions").select("id, content, knowledge_context").in("id", batch).order("id").range(from,to))),
    readIdBatches(ids, (batch) => readPages((from,to)=>client.from("unit_entities").select("unit_id, entity_id, role").in("unit_id", batch).neq("role", "mentioned").order("unit_id").order("entity_id").range(from,to))),
    readIdBatches(ids, (batch) => readPages((from,to)=>client.from("unit_domains").select("unit_id, domain_id").in("unit_id", batch).order("unit_id").order("domain_id").range(from,to))),
  ]);
  const domainIds = [...new Set(placements.map((row) => row.domain_id))];
  const entityIds = [...new Set(links.map((row) => row.entity_id))];
  const [domains, entities] = await Promise.all([
    readIdBatches(domainIds, (batch) => readPages((from,to)=>client.from("domains").select("id, path").in("id", batch).order("id").range(from,to))),
    readIdBatches(entityIds, (batch) => readPages((from,to)=>client.from("entities").select("id, type, key, name").in("id", batch).is("merged_into_id", null).is("retired_at", null).order("id").range(from,to))),
  ]);
  const revisionById = new Map(revisions.map((revision) => [revision.id, revision]));
  const pathById = new Map(domains.map((domain) => [domain.id, domain.path]));
  const liveEntities = new Set(entities.map((entity) => entity.id));
  const claims = units.map((unit): Claim => {
    const revision = revisionById.get(unit.current_revision_id);
    return {
      unitId: unit.id, revisionId: unit.current_revision_id, content: revision?.content ?? "", context: parseKnowledgeContext(revision?.knowledge_context),
      kind: unit.kind, epistemicStatus: unit.epistemic_status,
      topics: placements.filter((row) => row.unit_id === unit.id).flatMap((row) => pathById.get(row.domain_id) ?? []),
      entityIds: [...new Set(links.filter((row) => row.unit_id === unit.id && liveEntities.has(row.entity_id)).map((row) => row.entity_id))],
    };
  }).filter((claim) => claim.content.trim());
  return { claims, entities };
}

// PROPOSE: one call per batch of claims, with one corrective retry; a batch whose answer
// is cut off runs again as two halves
async function propose(deps: OrchestratorDeps, claims: Claim[], entities: ProposerEntity[], scope: string): Promise<TokenUsage & { planned: PlannedArticle[] }> {
  const charter = await readArticleCharter(deps.db);
  const instructions = `${skillInstructions(["plan_articles"], deps.settings.skills)}\n${ARTICLE_PROPOSER_PROMPT}`;
  const planned: PlannedArticle[] = [];
  let usage: TokenUsage = { tokensIn: 0, tokensOut: 0 };
  const proposeBatch = async (batch: Claim[]): Promise<void> => {
    const fingerprint=createHash("sha256").update(JSON.stringify(batch.map(claim=>[claim.unitId,claim.revisionId]))).digest("hex").slice(0,24);
    const saved=await workflowStep(`article-proposal-batch:${scope}:${fingerprint}`,async()=>{
    const batchKey = `article-proposal-batch:${scope}:${fingerprint}`;
    const input = await workflowStep(`${batchKey}:input-v1`, async () => ({ charter, articles: await deps.db.call<ArticleIndexEntry[]>("article_index"), entities, claims: batch }));
    const request = { name: "article_proposals", schema: articleProposalsSchema, jsonSchema: articleProposalsJsonSchema, maxTokens: ANSWER_TOKEN_BUDGET, messages: buildProposerMessages(instructions, input) };
    let answer = await workflowStep(`${batchKey}:draft-v1`, () => chatJson(deps.settings, request));
    let batchUsage:TokenUsage={tokensIn:answer.tokensIn,tokensOut:answer.tokensOut};
    let proposals:PlannedArticle[];
    try { proposals=readProposals(answer.value, input); }
    catch (error) {
      answer = await workflowStep(`${batchKey}:repair-v1:answer`, () => chatJson(deps.settings, { ...request, messages: [...request.messages, { role: "user", content: `Your previous proposals failed validation: ${error instanceof Error ? error.message : String(error)}. Previous proposals (untrusted data): ${JSON.stringify(answer.value)}. Return the complete corrected proposals.` }] }));
      batchUsage = addUsage(batchUsage, answer);
      proposals=readProposals(answer.value, input);
    }
    return {planned:proposals,...batchUsage};
    });
    usage=addUsage(usage,saved);planned.push(...saved.planned);
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
export async function newArticleSections(deps: OrchestratorDeps, item: Extract<PlannedArticle, { action: "create" }>): Promise<TokenUsage & { sections: SectionDraft[] }> {
  const entity = item.type === "entity" && item.entity ? item.entity : { id: "", type: "", key: "", name: item.title };
  const own = new Set(item.claims.map(claim => claim.unitId));
  const candidates = await articleKnowledgeCandidates(deps.db, item.title, item.scope, deps.embedder);
  const extra = await loadArticleClaims(deps.client, candidates.filter(id => !own.has(id)));
  const selection = extra.claims.length ? await groupClaimsForArticle(deps.settings, item.title, [], extra.claims,
    "Select all relevant saved knowledge before planning this new article's complete scaffold. These provisional groups are evidence selections, not final headings.", item.scope) : { sections: [], tokensIn: 0, tokensOut: 0 };
  const selected = new Set(selection.sections.flatMap(section => section.query.unitIds ?? []));
  const knowledge = { entity, units: [...item.claims, ...extra.claims.filter(claim => selected.has(claim.unitId))] };
  const { plan, ...planningUsage } = await planArticle(deps.settings, knowledge, `${item.title}. Scope: ${item.scope}`,
    "Finish the complete article scaffold before prose is written. Group all supplied knowledge coherently; avoid a heading per batch, fact, or example. Choose the reading order and evidence assignments first.");
  const usage = addUsage(selection, planningUsage);
  // A section that lists its claims needs no entity filter: the filter can only hide claims the
  // plan picked (a definition is about its term, not the organization), leaving the section unwritable
  const sections = topicSections(plan, knowledge).map((section) => {
    if (entity.id && !section.query.unitIds?.length) return section;
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

type Outcome = { verdict: ArticleReviewDecision["verdict"]; pageId: string | null; outlinePolicyVersion?: string };

// CARRY OUT ONE PROPOSAL: review it (new articles only), act on the verdict, record the decision
async function carryOut(deps: OrchestratorDeps, eventId: string | null, item: PlannedArticle, key: string): Promise<Outcome> {
  // Freeze the reviewed decision and exact write intent before committing it.
  // Retrying a lost audit reply must not ask the AI for a different decision
  // after the original article has already been saved.
  const prepared = await workflowStep(`${key}:prepare-v1`, async () => {
  const proposal: ArticleProposal = item.action === "create"
    ? { title: item.title, type: item.type, scope: item.scope, parentPageId: item.parentPageId, claims: item.claims.map((claim, index) => ({ ref: `C${index + 1}`, content: claim.content })) }
    : { title: "", type: "concept", scope: "", parentPageId: null, claims: item.claims.map((claim, index) => ({ ref: `C${index + 1}`, content: claim.content })) };
  let review: ArticleReviewDecision & { model: string | null; promptVersion: string; tokensIn: number | null; tokensOut: number | null };
  if (item.action === "update") {
    review = { verdict: "update_existing", targetPageId: item.pageId, sectionTitle: null, failed: [], reason: "The proposer sent these claims to an existing article.", decidedBy: "rule", model: null, promptVersion: ARTICLE_PROPOSER_PROMPT_VERSION, tokensIn: 0, tokensOut: 0 };
  } else {
    const articles = await deps.db.call<ArticleIndexEntry[]>("article_index");
    review = await workflowStep(`${key}:review-v1`, async () => reviewArticleProposal(deps.settings, { charter: await readArticleCharter(deps.db), articles, proposal, related: await relatedKnowledge(deps, item) }));
  }
  const step = nextStep(review, proposal);
  const unitIds = item.claims.map((claim) => claim.unitId);
  const actions: DraftAction[] = [];
  let usage: TokenUsage = { tokensIn: 0, tokensOut: 0 };
  let summary = "";
  // An outline that never passes independent review is a completed editorial decision, not a
  // failed write: nothing is published, the reviews are kept and the claims stay saved. This holds
  // for a new article and for an existing one re-planned to take the claims. Transport,
  // validation and storage failures still fail the step.
  const declined = (error: OutlineRejectedError) => {
    const issues = error.attempts.at(-1)?.review?.blockingIssues ?? error.attempts.at(-1)?.problems ?? [];
    const what = step.kind === "create_article" ? "No article was published" : "The article was not changed";
    const rejected = { ...review, verdict: "reject" as const, targetPageId: null, sectionTitle: null,
      reason: `${what} because its outline did not pass independent review after ${error.attempts.length} attempts. Claims remain saved.${issues.length ? ` ${issues.join(" ")}` : ""}`,
      promptVersion: `${review.promptVersion}+${OUTLINE_POLICY_VERSION}` };
    return { proposal, review: rejected, unitIds, actions: [], usage: addUsage(usage, error.usage), summary: "", kind: "none" as const, pageId: null,
      outlineReview: { policyVersion: OUTLINE_POLICY_VERSION, attempts: error.attempts } };
  };
  try {
    if (step.kind === "create_article" && item.action === "create") {
      const { sections, ...planUsage } = await newArticleSections(deps, item);
      usage = addUsage(usage, planUsage);
      actions.push({ ...base, type: "create_page", input: { title: item.title, entityId: item.type === "entity" ? item.entity?.id ?? null : null, articleType: item.type, scope: item.scope, parentPageId: item.parentPageId, sections } });
      summary = `Created the article “${item.title}” after independent review`;
    } else if (step.kind === "update_article") {
      const { sections, ...groupUsage } = await updateSections(deps, step.pageId, item.claims);
      usage = addUsage(usage, groupUsage);
      actions.push(...await articleAdditionActions(deps.db, deps.client, deps.settings, step.pageId, sections));
      summary = item.action === "create" ? `Added new knowledge to an existing article instead of creating “${item.title}”` : "Added new knowledge to an existing article";
    } else if (step.kind === "add_section") {
      actions.push(...await articleAdditionActions(deps.db, deps.client, deps.settings, step.pageId,
        [{ title: step.title, query: { unitIds, article: true } }], `Integrate the reviewed facet ${JSON.stringify(step.title)} with related existing topics where coherent.`));
      summary = `Added “${step.title}” as a section instead of a separate article`;
    }
  } catch (error) {
    if (error instanceof OutlineRejectedError) return declined(error);
    throw error;
  }
  return { proposal, review, unitIds, actions, usage, summary, kind: step.kind,
    pageId: step.kind === "update_article" || step.kind === "add_section" ? step.pageId : null };
  });
  const { proposal, review, unitIds, actions, usage, summary } = prepared;
  let changeSetId: string | null = null;
  let pageId = prepared.pageId;
  if (actions.length) {
    const submitted = await submitChangeSet(deps.db, { eventId, cause: eventId ? "upload" : "edit", actor: "ai", operationKey: key }, {
      summary, actions,
      trace: { modelVersion: deps.settings.model ?? null, promptVersion: `${skillTrace(ARTICLE_PROPOSER_PROMPT_VERSION, ["plan_articles"], deps.settings.skills)}+${ARTICLE_REVIEW_PROMPT_VERSION}`, tokensIn: usage.tokensIn, tokensOut: usage.tokensOut },
    });
    changeSetId = submitted.changeSetId;
    const result = await commitChangeSet(deps.db, changeSetId);
    if (result.status === "rejected" || result.rejected > 0) throw new Error(`Article proposal was not fully applied. Review change set ${changeSetId} in Changes.`);
    if (prepared.kind === "create_article") {
      const { data, error } = await deps.client.from("actions").select("target_id").eq("change_set_id", changeSetId).eq("type", "create_page").eq("outcome", "applied").maybeSingle();
      if (error) throw new Error(error.message);
      pageId = data?.target_id ?? null;
      if (pageId) {
        const live = await readArticleStructure(deps.db, pageId);
        await saveArticleStructure(deps.db, { pageId, key: `initial:${key}`, structure: live.current, changes: { created: true },
          rationale: "The reviewed initial outline assigns the selected evidence before article writing starts.", model: deps.settings.model ?? null });
      }
    }
  }
  const record = {
    event_id: eventId, proposal: { action: item.action, ...proposal, entity: item.action === "create" ? item.entity?.name ?? null : null, claimIds: unitIds,
      ...("outlineReview" in prepared ? { outlineReview: prepared.outlineReview } : {}) },
    verdict: review.verdict, failed_checks: review.failed, reason: review.reason, decided_by: review.decidedBy,
    target_page_id: review.targetPageId, section_title: review.sectionTitle, result_page_id: pageId, change_set_id: changeSetId,
    model: review.model, prompt_version: review.promptVersion, tokens_in: review.tokensIn, tokens_out: review.tokensOut,
  };
  // A deterministic upload audit ID makes a lost insert reply safe to replay.
  const hash = createHash("sha256").update(JSON.stringify(["article-review-v1", eventId, key])).digest("hex");
  const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-8${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
  const { error } = eventId
    ? await deps.client.from("article_reviews").upsert({ ...record, id }, { onConflict: "id", ignoreDuplicates: true })
    : await deps.client.from("article_reviews").insert(record);
  if (error) throw new Error(`Article review could not be recorded: ${error.message}`);
  return { verdict: review.verdict, pageId,
    ...("outlineReview" in prepared && prepared.outlineReview ? { outlinePolicyVersion: prepared.outlineReview.policyVersion } : {}) };
}

// Try every independent proposal. Upload failures remain retryable checkpoints;
// manual runs record failures while leaving the claims in the store.
async function carryOutSafely(deps: OrchestratorDeps, eventId: string | null, item: PlannedArticle, key: string): Promise<Outcome> {
  try { return await carryOut(deps, eventId, item, key); }
  catch (error) {
    // A failed upload proposal is unfinished work, not a reviewer rejection.
    // Let its workflow checkpoint fail so resume can retry it.
    if (eventId || uploadExecution.getStore()) throw error;
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
  const { claims, entities } = await workflowStep(`article-input:${scope}:v1`, () => loadArticleClaims(deps.client, unitIds));
  // Small updates can still belong in an existing article. The independent
  // reviewer's minimum-claim rule continues to guard creation of new articles.
  if (!claims.length) return result;
  const { planned } = await workflowStep(`article-proposals:${scope}`, () => propose(deps, claims, entities, scope));
  // jsonb reorders object keys. Save the operation keys before executing any
  // proposal, rather than recomputing hashes from a resumed JSON representation.
  const keys = await workflowStep(`article-keys:${scope}`, async () => planned.map((item, index) =>
    `article:${scope}:${index}:${createHash("sha256").update(JSON.stringify(item)).digest("hex").slice(0, 16)}`));
  let failed = false;
  let failure: unknown;
  const progressStep = eventId && (scope === eventId || scope === `enrichment:${eventId}`) ? "plan" : null;
  let completed = 0;
  if (progressStep) await reportUploadProgress({ step: progressStep, done: completed, total: planned.length });
  // Where each new article landed, by title, for the articles proposed under it. Parents come
  // first (readProposals); one the reviewer turned down leaves its children at the top level.
  const landed = new Map<string, string | null>();
  for (const [index, planItem] of planned.entries()) {
    uploadExecution.getStore()?.signal?.throwIfAborted();
    const key = keys[index]!;
    const item: PlannedArticle = planItem.action === "create" && planItem.parentTitle
      ? { ...planItem, parentPageId: landed.get(planItem.parentTitle.trim().toLowerCase()) ?? null } : planItem;
    let outcome: Outcome;
    try {
      outcome = await workflowStep(key, () => carryOutSafely(deps, eventId, item, key));
      const execution = uploadExecution.getStore();
      if (execution && outcome.verdict === "reject" && outcome.outlinePolicyVersion !== OUTLINE_POLICY_VERSION) {
        const prior = await execution.db.call<{ done: boolean; output?: { outlineReview?: { policyVersion: string } } }>("read_completed_upload_step",
          { p_event_id: execution.eventId, p_token: execution.token, p_key: `${key}:prepare-v1` });
        if (prior.done && prior.output?.outlineReview && /^article-outline-v[567]-/.test(prior.output.outlineReview.policyVersion)) {
          // One audited reassessment for the old rubric mismatch. Keep the
          // original decision immutable, recheck today's article index, and
          // never replay a completed reassessment on a later resume.
          const recoveryKey = `${key}:outline-rubric-recovery-v1`;
          outcome = await workflowStep(recoveryKey, () => carryOutSafely(deps, eventId, item, recoveryKey));
        }
      }
    }
    catch (error) {
      if (!failed) { failed = true; failure = error; }
      continue;
    }
    if (item.action === "create") landed.set(item.title.trim().toLowerCase(), outcome.pageId);
    if (outcome.verdict === "approve") result.created++;
    else if (outcome.verdict === "update_existing") result.updated++;
    else if (outcome.verdict === "section_of") result.sections++;
    else result.rejected++;
    if (outcome.pageId && !result.pageIds.includes(outcome.pageId)) result.pageIds.push(outcome.pageId);
    completed++;
    if (progressStep) await reportUploadProgress({ step: progressStep, done: completed, total: planned.length });
  }
  if (failed) throw failure;
  return result;
}

// After an upload: the claims it added or changed
export async function orchestrateEventArticles(deps: OrchestratorDeps, eventId: string, scope = eventId, unitIds?: string[]): Promise<OrchestratorResult> {
  return orchestrate(deps, eventId, scope, unitIds ?? await eventUnitIds(deps.db, eventId));
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
