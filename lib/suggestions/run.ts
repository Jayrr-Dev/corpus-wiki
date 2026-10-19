import "server-only";
import { addUsage, ANSWER_TOKEN_BUDGET, chatJson, tokenFactoryFromEnv, type TokenFactorySettings, type TokenUsage } from "@/lib/ai/chat";
import { type Embedder, embedderFromEnv } from "@/lib/ai/embeddings";
import { readArticleCharter, readModelChoice } from "@/lib/ai/models";
import { skillInstructions } from "@/lib/ai/skills/prompt";
import type { DraftAction } from "@/lib/ai/types";
import { commitChangeSet, submitChangeSet } from "@/lib/change-control";
import { titleOverlap } from "@/lib/curator/score";
import type { Json, TablesUpdate } from "@/lib/database/types";
import type { DbRpc } from "@/lib/db/rpc";
import { embedMissingUnits, savedVectors, similarUnits } from "@/lib/knowledge/embeddingStore";
import { rebuildPage, type SectionWriter } from "@/lib/living-page";
import { loadArticleClaims } from "@/lib/living-page/articleOrchestrator";
import type { ArticleIndexEntry } from "@/lib/living-page/articleReview";
import { applyArticleScaffold } from "@/lib/living-page/articleScaffold";
import { readArticleStructure, saveArticleStructure } from "@/lib/living-page/articleStructureMemory";
import { readIdBatches, readPages } from "@/lib/queries/batched";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { type GroupLink, type GroupUnit, groupUnits, type UnitGroup, withoutDismissed } from "./group";
import { buildSuggestionMessages, type CloseArticle, MIN_NEW_ARTICLE_CLAIMS, readSuggestions, type SuggestedSection, SUGGESTION_PROMPT, SUGGESTION_PROMPT_VERSION,
  type SuggestionInput, suggestionsJsonSchema, suggestionsSchema } from "./suggest";

// =====================================================================
// ARTICLE SUGGESTION JOBS. Two kinds, both claimed with a lease by
// claim_suggestion_work (see the migration), so a worker that dies or a
// tab that closes leaves the job for the next worker:
//   run    group the unused knowledge (saved once), then ask the AI about
//          each group, saving its suggestions as soon as they arrive
//   apply  a person accepted a suggestion: re-check it, then create the
//          article or merge into one through change control
// =====================================================================

export const MAX_GROUPS_PER_RUN = 40;
const VECTOR_BATCH = 256;
const CLOSEST_ARTICLES = 4;
const ARTICLE_INDEX_LIMIT = 300;
const SIMILAR_TITLE = 0.8;

export type SuggestionScope = { domainId?: string | null };
type SavedGroup = UnitGroup & { status: "pending" | "done" | "failed"; error?: string };
type Claim = { kind: "run" | "apply"; id: string; token: string };
export type SuggestionDeps = { db: DbRpc; client: AdminSupabase; settings: TokenFactorySettings; embedder: Embedder; writer: () => Promise<SectionWriter> };

class LeaseLost extends Error {}

async function readSettings(db: DbRpc): Promise<TokenFactorySettings> {
  const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db), (call) => db.call("log_ai_call", { p_call: call }));
  if (!settings) throw new Error("Configure an AI provider in Settings before running suggestions.");
  return settings;
}

// One job in the current space; false when there is nothing to do
export async function processSuggestionWork(db: DbRpc, client: AdminSupabase, writer: () => Promise<SectionWriter>): Promise<boolean> {
  const claim = await db.call<Claim | null>("claim_suggestion_work");
  if (!claim) return false;
  const embedder = embedderFromEnv(process.env, (call) => db.call("log_ai_call", { p_call: call }));
  try {
    const settings = await readSettings(db);
    if (!embedder) throw new Error("Configure an embedding provider before running suggestions.");
    const deps: SuggestionDeps = { db, client, settings, embedder, writer };
    if (claim.kind === "run") await runSuggestions(deps, claim);
    else await applySuggestion(deps, claim);
  } catch (error) {
    if (error instanceof LeaseLost) return true;
    await recordFailure(client, claim, error instanceof Error ? error.message : String(error));
  }
  return true;
}

// A failed attempt is retried in a minute; the third failure is final
async function recordFailure(client: AdminSupabase, claim: Claim, message: string) {
  const retryAt = new Date(Date.now() + 60_000).toISOString();
  if (claim.kind === "run") {
    const { data } = await client.from("suggestion_runs").select("attempts").eq("id", claim.id).single();
    const final = (data?.attempts ?? 3) >= 3;
    await client.from("suggestion_runs").update(final ? { state: "failed", error: message, lease_token: null, lease_until: null, finished_at: new Date().toISOString() }
      : { error: message, lease_until: retryAt }).eq("id", claim.id).eq("lease_token", claim.token);
  } else {
    const { data } = await client.from("article_suggestions").select("attempts").eq("id", claim.id).single();
    const final = (data?.attempts ?? 3) >= 3;
    await client.from("article_suggestions").update(final ? { status: "failed", note: message, lease_token: null, lease_until: null } : { note: message, lease_until: retryAt })
      .eq("id", claim.id).eq("lease_token", claim.token);
  }
}

async function renew(db: DbRpc, claim: Claim) {
  if (!(await db.call<boolean>("renew_suggestion_lease", { p_kind: claim.kind, p_id: claim.id, p_token: claim.token }))) throw new LeaseLost();
}

// =====================================================================
// RUN
// =====================================================================

async function runSuggestions(deps: SuggestionDeps, claim: Claim) {
  const { client } = deps;
  const { data: run, error } = await client.from("suggestion_runs").select("*").eq("id", claim.id).single();
  if (error) throw new Error(error.message);
  const save = async (patch: TablesUpdate<"suggestion_runs">) => {
    const { data, error: saveError } = await client.from("suggestion_runs").update(patch).eq("id", claim.id).eq("lease_token", claim.token).select("id");
    if (saveError) throw new Error(saveError.message);
    if (!data?.length) throw new LeaseLost();
  };
  let groups = run.groups as SavedGroup[] | null;
  if (!groups) {
    await save({ phase: "grouping", error: null });
    groups = (await groupForRun(deps, (run.scope ?? {}) as SuggestionScope)).map((group) => ({ ...group, status: "pending" as const }));
    await save({ groups: groups as unknown as Json, total: groups.length, done: 0, phase: "suggesting" });
  }
  let usage: TokenUsage = { tokensIn: run.tokens_in, tokensOut: run.tokens_out };
  let suggested = run.suggested;
  const context = await suggestionContext(deps);
  for (const group of groups) {
    if (group.status !== "pending") continue;
    await renew(deps.db, claim);
    // A previous attempt may have saved this group's suggestions before it stopped
    const { count } = await client.from("article_suggestions").select("id", { count: "exact", head: true }).eq("run_id", claim.id).eq("group_key", group.key);
    try {
      if (!count) {
        const result = await suggestForGroup(deps, context, group);
        usage = addUsage(usage, result);
        if (result.rows.length) {
          const { error: insertError } = await client.from("article_suggestions").insert(result.rows.map((row) => ({ ...row, run_id: claim.id })));
          if (insertError) throw new Error(insertError.message);
        }
        suggested += result.rows.length;
      }
      group.status = "done";
    } catch (groupError) {
      if (groupError instanceof LeaseLost) throw groupError;
      group.status = "failed";
      group.error = groupError instanceof Error ? groupError.message : String(groupError);
    }
    await save({ groups: groups as unknown as Json, done: groups.filter((item) => item.status !== "pending").length, suggested, tokens_in: usage.tokensIn ?? 0, tokens_out: usage.tokensOut ?? 0 });
  }
  const failed = groups.filter((group) => group.status === "failed");
  await save({ state: "done", phase: null, lease_token: null, lease_until: null, finished_at: new Date().toISOString(),
    error: failed.length ? `${failed.length} of ${groups.length} group(s) could not be suggested: ${failed[0]!.error}` : null });
}

// GROUPING: current units no live article cites and no open suggestion holds
async function groupForRun(deps: SuggestionDeps, scope: SuggestionScope): Promise<UnitGroup[]> {
  const { db, client, embedder } = deps;
  const [units, cited, held, domains, dismissed] = await Promise.all([
    readPages((from, to) => client.from("units").select("id, current_revision_id").is("retired_at", null).order("id").range(from, to)),
    readPages((from, to) => client.from("section_knowledge").select("unit_id").order("unit_id").order("section_id").range(from, to)),
    db.call<string[]>("held_suggestion_units"),
    readPages((from, to) => client.from("domains").select("id, path, parent_id").is("retired_at", null).order("id").range(from, to)),
    readPages((from, to) => client.from("article_suggestions").select("unit_ids, revision_ids").eq("status", "dismissed").order("id").range(from, to)),
  ]);
  const skip = new Set([...cited.map((row) => row.unit_id), ...held]);
  let candidates = units.filter((unit) => !skip.has(unit.id));
  if (scope.domainId) {
    const root = domains.find((domain) => domain.id === scope.domainId);
    if (!root) throw new Error("The chosen domain no longer exists.");
    const inScope = new Set(domains.filter((domain) => domain.path === root.path || domain.path.startsWith(`${root.path}/`)).map((domain) => domain.id));
    const placed = await readIdBatches(candidates.map((unit) => unit.id), (batch) => readPages((from, to) =>
      client.from("unit_domains").select("unit_id, domain_id").in("unit_id", batch).order("unit_id").order("domain_id").range(from, to)));
    const keep = new Set(placed.filter((row) => inScope.has(row.domain_id)).map((row) => row.unit_id));
    candidates = candidates.filter((unit) => keep.has(unit.id));
  }
  if (!candidates.length) return [];
  await embedMissingUnits(db, embedder);
  const ids = candidates.map((unit) => unit.id);
  const vectors = new Map<string, number[]>();
  for (let index = 0; index < candidates.length; index += VECTOR_BATCH) {
    for (const [revisionId, vector] of await savedVectors(db, embedder.model, candidates.slice(index, index + VECTOR_BATCH).map((unit) => unit.current_revision_id))) vectors.set(revisionId, vector);
  }
  const [placements, entities, sources, relationships] = await Promise.all([
    readIdBatches(ids, (batch) => readPages((from, to) => client.from("unit_domains").select("unit_id, domain_id").in("unit_id", batch).order("unit_id").order("domain_id").range(from, to))),
    readIdBatches(ids, (batch) => readPages((from, to) => client.from("unit_entities").select("unit_id, entity_id").in("unit_id", batch).neq("role", "mentioned").order("unit_id").order("entity_id").range(from, to))),
    readIdBatches(ids, (batch) => readPages((from, to) => client.from("source_units").select("unit_id, source_id").in("unit_id", batch).order("unit_id").order("source_id").range(from, to))),
    readIdBatches(ids, (batch) => readPages((from, to) => client.from("relationships").select("id, from_unit_id, to_unit_id, type").in("from_unit_id", batch).is("retired_at", null).order("id").range(from, to))),
  ]);
  const pathById = new Map(domains.map((domain) => [domain.id, domain.path]));
  const byUnit = <T extends { unit_id: string | null }>(rows: T[], pick: (row: T) => string | null) => {
    const map = new Map<string, string[]>();
    for (const row of rows) { const value = pick(row); if (row.unit_id && value) map.set(row.unit_id, [...(map.get(row.unit_id) ?? []), value]); }
    return map;
  };
  const domainsOf = byUnit(placements, (row) => row.domain_id);
  const entitiesOf = byUnit(entities, (row) => row.entity_id);
  const sourcesOf = byUnit(sources, (row) => row.source_id);
  const groupInput: GroupUnit[] = candidates.flatMap((unit) => {
    const vector = vectors.get(unit.current_revision_id);
    if (!vector) return [];
    const domainIds = domainsOf.get(unit.id) ?? [];
    const roots = domainIds.map((id) => pathById.get(id)?.split("/")[0]).filter((root): root is string => Boolean(root)).sort();
    return [{ id: unit.id, revisionId: unit.current_revision_id, vector, domainIds, rootDomainId: roots[0] ?? null, entityIds: entitiesOf.get(unit.id) ?? [], sourceIds: sourcesOf.get(unit.id) ?? [] }];
  });
  const inSet = new Set(ids);
  const links: GroupLink[] = relationships.filter((row) => inSet.has(row.to_unit_id)).map((row) => ({ from: row.from_unit_id, to: row.to_unit_id, type: row.type }));
  const { groups } = groupUnits(groupInput, links);
  return withoutDismissed(groups, dismissed.map((row) => ({ unitIds: row.unit_ids, revisionIds: row.revision_ids }))).slice(0, MAX_GROUPS_PER_RUN);
}

type RunContext = { charter: SuggestionInput["charter"]; articles: ArticleIndexEntry[]; instructions: string };
async function suggestionContext(deps: SuggestionDeps): Promise<RunContext> {
  const [charter, articles] = await Promise.all([readArticleCharter(deps.db), deps.db.call<ArticleIndexEntry[]>("article_index")]);
  return { charter, articles, instructions: `${skillInstructions(["plan_articles"], deps.settings.skills)}\n${SUGGESTION_PROMPT}` };
}

// The articles nearest a group: its mean vector's nearest cited knowledge, by the articles that cite it
async function closestArticles(deps: SuggestionDeps, vectors: number[][]): Promise<CloseArticle[]> {
  if (!vectors.length) return [];
  const centroid = vectors[0]!.map((_, index) => vectors.reduce((sum, vector) => sum + vector[index]!, 0) / vectors.length);
  const near = await similarUnits(deps.db, deps.embedder.model, centroid, 60, 0.55);
  if (!near.length) return [];
  const similarity = new Map(near.map((unit) => [unit.unitId, unit.similarity]));
  const cites = await readIdBatches(near.map((unit) => unit.unitId), (batch) => readPages((from, to) =>
    deps.client.from("section_knowledge").select("page_id, unit_id").in("unit_id", batch).order("page_id").order("unit_id").range(from, to)));
  const byPage = new Map<string, Set<string>>();
  for (const row of cites) if (row.page_id && row.unit_id) byPage.set(row.page_id, (byPage.get(row.page_id) ?? new Set()).add(row.unit_id));
  const ranked = [...byPage].map(([pageId, units]) => {
    const top = [...units].map((id) => similarity.get(id) ?? 0).sort((a, b) => b - a).slice(0, 3);
    return { id: pageId, closeness: top.reduce((sum, value) => sum + value, 0) / top.length };
  }).sort((a, b) => b.closeness - a.closeness || a.id.localeCompare(b.id)).slice(0, CLOSEST_ARTICLES);
  return Promise.all(ranked.map(async (page) => {
    const { data, error } = await deps.client.from("sections").select("id, title").eq("page_id", page.id).is("retired_at", null).order("position");
    if (error) throw new Error(error.message);
    return { ...page, sections: data ?? [] };
  }));
}

// Short enough for every call: the closest articles and their parents, then the most cited
function articleIndexFor(articles: ArticleIndexEntry[], closest: CloseArticle[]): ArticleIndexEntry[] {
  if (articles.length <= ARTICLE_INDEX_LIMIT) return articles;
  const keep = new Set(closest.map((page) => page.id));
  for (const article of articles) if (keep.has(article.id) && article.parentId) keep.add(article.parentId);
  const rest = articles.filter((article) => !keep.has(article.id)).sort((a, b) => b.claimCount - a.claimCount).slice(0, ARTICLE_INDEX_LIMIT - keep.size);
  return [...articles.filter((article) => keep.has(article.id)), ...rest];
}

type SuggestionRow = { group_key: string; kind: "create" | "merge"; page_id: string | null; title: string; article_type: "entity" | "process" | "requirement" | "concept" | null;
  entity_id: string | null; scope: string; rationale: string; sections: Json; unit_ids: string[]; revision_ids: string[]; signals: Json; model: string | null; tokens_in: number | null; tokens_out: number | null };

async function suggestForGroup(deps: SuggestionDeps, context: RunContext, group: SavedGroup): Promise<TokenUsage & { rows: SuggestionRow[] }> {
  const { claims, entities } = await loadArticleClaims(deps.client, group.unitIds);
  if (claims.length < MIN_NEW_ARTICLE_CLAIMS) return { rows: [], tokensIn: 0, tokensOut: 0 };
  const vectors = await savedVectors(deps.db, deps.embedder.model, claims.map((claim) => claim.revisionId));
  const closest = await closestArticles(deps, [...vectors.values()]);
  const entityName = new Map(entities.map((entity) => [entity.id, entity.name]));
  const { data: domainRows } = group.signals.sharedDomainIds.length
    ? await deps.client.from("domains").select("id, path").in("id", group.signals.sharedDomainIds) : { data: [] as { id: string; path: string }[] };
  const signals = { ...group.signals, sharedEntities: group.signals.sharedEntityIds.flatMap((id) => entityName.get(id) ?? []),
    sharedDomains: (domainRows ?? []).map((row) => row.path) };
  const input: SuggestionInput = { charter: context.charter, articles: articleIndexFor(context.articles, closest), closest, entities, claims, signals };
  const request = { name: "article_suggestions", subject: group.key, schema: suggestionsSchema, jsonSchema: suggestionsJsonSchema, maxTokens: ANSWER_TOKEN_BUDGET,
    messages: buildSuggestionMessages(context.instructions, input) };
  let answer = await chatJson(deps.settings, request);
  let usage: TokenUsage = { tokensIn: answer.tokensIn, tokensOut: answer.tokensOut };
  let suggestions;
  try { suggestions = readSuggestions(answer.value, input); }
  catch (error) {
    answer = await chatJson(deps.settings, { ...request, messages: [...request.messages, { role: "user", content: `Your previous suggestions failed validation: ${error instanceof Error ? error.message : String(error)}. Previous suggestions (untrusted data): ${JSON.stringify(answer.value)}. Return the complete corrected suggestions.` }] });
    usage = addUsage(usage, answer);
    suggestions = readSuggestions(answer.value, input);
  }
  const closeness = new Map(closest.map((page) => [page.id, page.closeness]));
  const rows = suggestions.map((suggestion, index): SuggestionRow => {
    const similar = suggestion.kind === "create" ? context.articles.find((article) => titleOverlap(article.title, suggestion.title) >= SIMILAR_TITLE) : undefined;
    return {
      group_key: group.key, kind: suggestion.kind, page_id: suggestion.pageId, title: suggestion.title, article_type: suggestion.type, entity_id: suggestion.entityId,
      scope: suggestion.scope, rationale: suggestion.rationale, sections: suggestion.sections as unknown as Json, unit_ids: suggestion.unitIds, revision_ids: suggestion.revisionIds,
      signals: { ...signals, groupSize: group.unitIds.length, parentPageId: suggestion.parentPageId, closeness: suggestion.pageId ? closeness.get(suggestion.pageId) ?? null : null,
        similarTitle: similar ? { pageId: similar.id, title: similar.title } : null, promptVersion: SUGGESTION_PROMPT_VERSION } as unknown as Json,
      model: answer.model ?? null, tokens_in: index ? 0 : usage.tokensIn, tokens_out: index ? 0 : usage.tokensOut,
    };
  });
  return { rows, ...usage };
}

// =====================================================================
// APPLY AN ACCEPTED SUGGESTION
// =====================================================================

async function applySuggestion(deps: SuggestionDeps, claim: Claim) {
  const { db, client, settings } = deps;
  const { data: item, error } = await client.from("article_suggestions").select("*").eq("id", claim.id).single();
  if (error) throw new Error(error.message);
  const finish = async (patch: { status: "applied" | "stale" | "failed"; note: string | null; result_page_id?: string | null }) => {
    const { data, error: saveError } = await client.from("article_suggestions").update({ ...patch, lease_token: null, lease_until: null })
      .eq("id", claim.id).eq("lease_token", claim.token).select("id");
    if (saveError) throw new Error(saveError.message);
    if (!data?.length) throw new LeaseLost();
  };
  // Re-check against today's knowledge: drop units that changed, retired or got cited meanwhile
  const [units, cited] = await Promise.all([
    readIdBatches(item.unit_ids, (batch) => readPages((from, to) => client.from("units").select("id, current_revision_id").in("id", batch).is("retired_at", null).order("id").range(from, to))),
    readIdBatches(item.unit_ids, (batch) => readPages((from, to) => client.from("section_knowledge").select("unit_id, page_id").in("unit_id", batch).order("unit_id").order("page_id").range(from, to))),
  ]);
  const expected = new Map(item.unit_ids.map((id, index) => [id, item.revision_ids[index]]));
  const citedIds = new Set(cited.map((row) => row.unit_id));
  const current = new Set(units.filter((unit) => expected.get(unit.id) === unit.current_revision_id && !citedIds.has(unit.id)).map((unit) => unit.id));
  const sections = (item.sections as unknown as SuggestedSection[])
    .map((section) => ({ ...section, unitIds: section.unitIds.filter((id) => current.has(id)) }))
    .filter((section) => section.unitIds.length);
  const kept = sections.flatMap((section) => section.unitIds).length;
  const dropped = item.unit_ids.length - kept;
  const droppedNote = dropped ? ` ${dropped} unit(s) were left out because they changed or an article cites them now.` : "";
  if (item.kind === "create" ? kept < MIN_NEW_ARTICLE_CLAIMS : kept < 1) {
    return finish({ status: "stale", note: `The knowledge changed since this was suggested.${droppedNote} Run suggestions again.` });
  }
  const writer = await deps.writer();
  if (item.kind === "merge") {
    const { data: page } = await client.from("pages").select("id").eq("id", item.page_id!).is("retired_at", null).maybeSingle();
    if (!page) return finish({ status: "stale", note: "The article this would merge into no longer exists." });
    const placements = sections.filter((section) => section.sectionId).map((section) => `“${section.title}”`);
    const note = `A person accepted this suggestion: ${item.rationale}${placements.length ? ` Add the supplied knowledge to the existing section(s) ${placements.join(", ")} where it fits.` : ""}`;
    await applyArticleScaffold(db, client, settings, writer, item.page_id!, sections.map((section) => ({ title: section.title, query: { unitIds: section.unitIds, article: true } })), note);
    return finish({ status: "applied", note: droppedNote.trim() || null, result_page_id: item.page_id });
  }
  const signals = (item.signals ?? {}) as { parentPageId?: string | null };
  const parent = signals.parentPageId
    ? (await client.from("pages").select("id").eq("id", signals.parentPageId).is("retired_at", null).maybeSingle()).data?.id ?? null : null;
  const actions: DraftAction[] = [{ targetId: null, expectedRevisionId: null, passageIds: [], speechAct: null, type: "create_page",
    input: { title: item.title, entityId: item.entity_id, articleType: item.article_type ?? "concept", scope: item.scope, parentPageId: parent,
      sections: sections.map((section) => ({ title: section.title, query: { unitIds: section.unitIds, article: true } })) } }];
  const { changeSetId } = await submitChangeSet(db, { eventId: null, cause: "edit", actor: "ai", operationKey: `article-suggestion:${item.id}` }, {
    summary: `Created the article “${item.title}” from an accepted suggestion`, actions,
    trace: { modelVersion: item.model, promptVersion: SUGGESTION_PROMPT_VERSION, tokensIn: 0, tokensOut: 0 },
  });
  const result = await commitChangeSet(db, changeSetId);
  if (result.status === "rejected" || result.rejected > 0) return finish({ status: "failed", note: `The article was not created. Review change set ${changeSetId} in Changes.` });
  const { data: created, error: createdError } = await client.from("actions").select("target_id").eq("change_set_id", changeSetId).eq("type", "create_page").eq("outcome", "applied").maybeSingle();
  if (createdError) throw new Error(createdError.message);
  const pageId = created?.target_id ?? null;
  if (!pageId) return finish({ status: "failed", note: "The article is waiting in Exceptions before it is created." });
  // Saved first: the article exists even if writing its text stops part way
  await finish({ status: "applied", note: droppedNote.trim() || null, result_page_id: pageId });
  const live = await readArticleStructure(db, pageId);
  await saveArticleStructure(db, { pageId, key: `initial:article-suggestion:${item.id}`, structure: live.current, changes: { created: true },
    rationale: "The accepted suggestion's outline assigns the knowledge before the article is written.", model: item.model });
  try { await rebuildPage(db, writer, pageId); }
  catch (writeError) {
    await client.from("article_suggestions").update({ note: `Created, but its text is not fully written: ${writeError instanceof Error ? writeError.message : String(writeError)}` }).eq("id", item.id);
  }
}

