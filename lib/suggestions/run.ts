import {
  addUsage,
  ANSWER_TOKEN_BUDGET,
  chatJson,
  tokenFactoryFromEnv,
  type TokenFactorySettings,
  type TokenUsage,
} from "@/lib/ai/chat";
import { type Embedder, embedderFromEnv } from "@/lib/ai/embeddings";
import { readArticleCharter, readModelChoice } from "@/lib/ai/models";
import { skillInstructions } from "@/lib/ai/skills/prompt";
import type { DraftAction, SectionQuery } from "@/lib/ai/types";
import { commitChangeSet, submitChangeSet } from "@/lib/change-control";
import { titleOverlap } from "@/lib/curator/score";
import type { Json, Tables, TablesUpdate } from "@/lib/database/types";
import type { DbRpc } from "@/lib/db/rpc";
import {
  embedMissingUnits,
  savedVectors,
  similarUnits,
} from "@/lib/knowledge/embeddingStore";
import {
  rebuildPage,
  rebuildUploadSection,
  type SectionState,
  type SectionWriter,
} from "@/lib/living-page";
import { loadArticleClaims } from "@/lib/living-page/articleOrchestrator";
import type { ArticleIndexEntry } from "@/lib/living-page/articleReview";
import {
  readArticleStructure,
  saveArticleStructure,
} from "@/lib/living-page/articleStructureMemory";
import type { SectionProgress } from "@/lib/living-page/buildProgress";
import { IncompleteSectionEvidence } from "@/lib/living-page/draftEvidence";
import { forwardSectionWriter } from "@/lib/living-page/forwardWriter";
import { OutlineRejectedError } from "@/lib/living-page/outlineBuilder";
import { processingCancellation } from "@/lib/processing/cancellation";
import { readIdBatches, readPages } from "@/lib/queries/batched";
import type { AdminSupabase } from "@/lib/supabase/admin";
import "server-only";
import {
  type ArticleHome,
  type GroupLink,
  type GroupUnit,
  groupUnits,
  likelyMerges,
  type UnitGroup,
  withoutDismissed,
} from "./group";
import { leaseHeartbeat } from "./leaseHeartbeat";
import {
  buildSuggestionMessages,
  type CloseArticle,
  MIN_NEW_ARTICLE_CLAIMS,
  readSuggestions,
  type SuggestedSection,
  SUGGESTION_PROMPT,
  SUGGESTION_PROMPT_VERSION,
  type SuggestionInput,
  suggestionsJsonSchema,
  suggestionsSchema,
} from "./suggest";

// =====================================================================
// ARTICLE SUGGESTION JOBS. Two kinds, both claimed with a lease by
// claim_suggestion_work (see the migration), so a worker that dies or a
// tab that closes leaves the job for the next worker:
//   run    group the unused knowledge (saved once), then ask the AI about
//          each group, saving its suggestions as soon as they arrive
//   apply  a person accepted a suggestion: re-check it, then create the
//          article or merge into one through change control
// =====================================================================

const VECTOR_BATCH = 256;
const HOME_SAMPLE = 40;
const CLOSEST_ARTICLES = 4;
const ARTICLE_INDEX_LIMIT = 300;
const SIMILAR_TITLE = 0.8;

export type SuggestionScope = {
  domainId?: string | null;
  unitIds?: string[];
  kind?: "create" | "merge";
};
type SavedGroup = UnitGroup & {
  status: "pending" | "done" | "failed";
  error?: string;
};
type Claim = { kind: "run" | "apply"; id: string; token: string };
export type SuggestionDeps = {
  db: DbRpc;
  client: AdminSupabase;
  settings: TokenFactorySettings;
  embedder: Embedder;
  writer: () => Promise<SectionWriter>;
};

class LeaseLost extends Error {
  constructor() { super("Another run took over this suggestion"); }
}

// How soon a cancel reaches an apply that is still writing
const APPLY_HEARTBEAT_MS = 5_000;
const activeApplies = new Map<string, AbortController>();

// Stops the apply running in this process. The suggestion row is already released.
export function abortSuggestionApply(id: string) {
  activeApplies.get(id)?.abort(new DOMException("Cancelled.", "AbortError"));
}

async function readSettings(db: DbRpc): Promise<TokenFactorySettings> {
  const settings = tokenFactoryFromEnv(
    process.env,
    await readModelChoice(db),
    (call) => db.call("log_ai_call", { p_call: call }),
  );
  if (!settings)
    throw new Error(
      "Configure an AI provider in Settings before running suggestions.",
    );
  return settings;
}

// One job in the current space; false when there is nothing to do
export async function processSuggestionWork(
  db: DbRpc,
  client: AdminSupabase,
  writer: () => Promise<SectionWriter>,
): Promise<boolean> {
  const claim = await db.call<Claim | null>("claim_suggestion_work");
  if (!claim) return false;
  const embedder = embedderFromEnv(process.env, (call) =>
    db.call("log_ai_call", { p_call: call }),
  );
  try {
    const settings = await readSettings(db);
    if (!embedder)
      throw new Error(
        "Configure an embedding provider before running suggestions.",
      );
    const deps: SuggestionDeps = { db, client, settings, embedder, writer };
    if (claim.kind === "run") await runSuggestions(deps, claim);
    else await applySuggestion(deps, claim);
  } catch (error) {
    // Cancel releases the row itself. A lost lease stops quietly. Don't schedule a retry over either.
    if (
      error instanceof LeaseLost ||
      (error instanceof Error && error.name === "AbortError")
    )
      return true;
    const message = error instanceof Error ? error.message : String(error);
    // The article was left unchanged on purpose. Close the suggestion instead of leaving it on Applying.
    if (
      claim.kind === "apply" &&
      message.includes("The existing article was kept.")
    ) {
      await client
        .from("article_suggestions")
        .update({
          status: "dismissed",
          note: message,
          lease_token: null,
          lease_until: null,
          decided_at: new Date().toISOString(),
        })
        .eq("id", claim.id)
        .eq("lease_token", claim.token);
      return true;
    }
    const writerDown =
      error instanceof TypeError ||
      message.includes("could not start") ||
      message.includes("is not a function");
    // A draft that still omits required evidence already used its repair passes.
    // Leave it failed so the card can be retried, instead of rewriting it again while it still says Applying.
    const evidenceRejected = error instanceof IncompleteSectionEvidence;
    await recordFailure(
      client,
      claim,
      writerDown
        ? "The article writer could not start. Retry this suggestion."
        : message,
      writerDown || evidenceRejected || error instanceof OutlineRejectedError,
    );
  }
  return true;
}

// A failed attempt is retried in a minute; the third failure is final.
// A rejected outline or a draft that still omits required evidence already spent its repair rounds, so it is not run again.
async function recordFailure(
  client: AdminSupabase,
  claim: Claim,
  message: string,
  permanent = false,
) {
  const retryAt = new Date(Date.now() + 60_000).toISOString();
  if (claim.kind === "run") {
    const { data } = await client
      .from("suggestion_runs")
      .select("attempts")
      .eq("id", claim.id)
      .single();
    const final = permanent || (data?.attempts ?? 3) >= 3;
    await client
      .from("suggestion_runs")
      .update(
        final
          ? {
              state: "failed",
              error: message,
              lease_token: null,
              lease_until: null,
              finished_at: new Date().toISOString(),
            }
          : { error: message, lease_until: retryAt },
      )
      .eq("id", claim.id)
      .eq("lease_token", claim.token);
  } else {
    const { data } = await client
      .from("article_suggestions")
      .select("attempts")
      .eq("id", claim.id)
      .single();
    const final = permanent || (data?.attempts ?? 3) >= 3;
    await client
      .from("article_suggestions")
      .update(
        final
          ? {
              status: "failed",
              note: message,
              lease_token: null,
              lease_until: null,
            }
          : { note: message, lease_until: retryAt },
      )
      .eq("id", claim.id)
      .eq("lease_token", claim.token);
  }
}

async function renew(db: DbRpc, claim: Claim) {
  if (
    !(await db.call<boolean>("renew_suggestion_lease", {
      p_kind: claim.kind,
      p_id: claim.id,
      p_token: claim.token,
    }))
  )
    throw new LeaseLost();
}

// =====================================================================
// RUN
// =====================================================================

async function runSuggestions(deps: SuggestionDeps, claim: Claim) {
  const { client } = deps;
  const { data: run, error } = await client
    .from("suggestion_runs")
    .select("*")
    .eq("id", claim.id)
    .single();
  if (error) throw new Error(error.message);
  const save = async (patch: TablesUpdate<"suggestion_runs">) => {
    const { data, error: saveError } = await client
      .from("suggestion_runs")
      .update(patch)
      .eq("id", claim.id)
      .eq("lease_token", claim.token)
      .select("id");
    if (saveError) throw new Error(saveError.message);
    if (!data?.length) throw new LeaseLost();
  };
  const scope = (run.scope ?? {}) as SuggestionScope;
  let groups = run.groups as SavedGroup[] | null;
  if (!groups) {
    await save({ phase: "grouping", error: null });
    const first = await groupForRun(
      deps,
      scope,
      scope.kind === "create" ? "leftover" : "merge",
    );
    groups = first.map((group) => ({
      ...group,
      status: "pending" as const,
    }));
    await save({
      groups: groups as unknown as Json,
      total: groups.length,
      done: 0,
      phase: "suggesting",
    });
  }
  let usage: TokenUsage = {
    tokensIn: run.tokens_in,
    tokensOut: run.tokens_out,
  };
  let suggested = run.suggested;
  const context = await suggestionContext(deps);
  const ask = async () => {
  for (const group of groups ?? []) {
    if (group.status !== "pending") continue;
    await renew(deps.db, claim);
    // A previous attempt may have saved this group's suggestions before it stopped
    const { count } = await client
      .from("article_suggestions")
      .select("id", { count: "exact", head: true })
      .eq("run_id", claim.id)
      .eq("group_key", group.key);
    try {
      if (!count) {
        const result = await suggestForGroup(
          deps,
          context,
          group,
          scope.kind ?? (group.lane === "merge" ? "merge" : undefined),
        );
        usage = addUsage(usage, result);
        if (result.rows.length) {
          const { error: insertError } = await client
            .from("article_suggestions")
            .insert(result.rows.map((row) => ({ ...row, run_id: claim.id })));
          if (insertError) throw new Error(insertError.message);
        }
        suggested += result.rows.length;
      }
      group.status = "done";
    } catch (groupError) {
      if (groupError instanceof LeaseLost) throw groupError;
      group.status = "failed";
      group.error =
        groupError instanceof Error ? groupError.message : String(groupError);
    }
    await save({
      groups: groups as unknown as Json,
      done: (groups ?? []).filter((item) => item.status !== "pending").length,
      suggested,
      tokens_in: usage.tokensIn ?? 0,
      tokens_out: usage.tokensOut ?? 0,
    });
  }
  };
  await ask();
  // Leftovers are grouped only after the merge answers are saved, so those claims are held out.
  if (scope.kind !== "merge" && !(groups ?? []).some((group) => group.lane === "leftover")) {
    await save({ phase: "grouping", error: null });
    const rest = await groupForRun(deps, scope, "leftover");
    const added = rest.map((group) => ({
      ...group,
      lane: "leftover" as const,
      status: "pending" as const,
    }));
    groups = [...(groups ?? []), ...added];
    await save({
      groups: groups as unknown as Json,
      total: groups.length,
      done: groups.filter((item) => item.status !== "pending").length,
      phase: "suggesting",
    });
    await ask();
  }
  const failed = (groups ?? []).filter((group) => group.status === "failed");
  await save({
    state: "done",
    phase: null,
    lease_token: null,
    lease_until: null,
    finished_at: new Date().toISOString(),
    error: failed.length
      ? `${failed.length} of ${(groups ?? []).length} group(s) could not be suggested: ${failed[0]!.error}`
      : null,
  });
}

// GROUPING: current units no live article cites and no processed suggestion holds.
// Pending, accepting, failed and applied suggestions hold their claims. Dismissed and stale do not.
// "merge" is the clear-home pool. "leftover" groups whatever is still unused.
async function groupForRun(
  deps: SuggestionDeps,
  scope: SuggestionScope,
  pass: "merge" | "leftover",
): Promise<UnitGroup[]> {
  const { db, client, embedder } = deps;
  const [units, cited, held, domains, dismissed] = await Promise.all([
    readPages((from, to) =>
      client
        .from("units")
        .select("id, current_revision_id")
        .is("retired_at", null)
        .order("id")
        .range(from, to),
    ),
    readPages((from, to) =>
      client
        .from("section_knowledge")
        .select("unit_id, page_id")
        .order("unit_id")
        .order("section_id")
        .range(from, to),
    ),
    db.call<string[]>("held_suggestion_units"),
    readPages((from, to) =>
      client
        .from("domains")
        .select("id, path, parent_id")
        .is("retired_at", null)
        .order("id")
        .range(from, to),
    ),
    readPages((from, to) =>
      client
        .from("article_suggestions")
        .select("unit_ids, revision_ids")
        .eq("status", "dismissed")
        .order("id")
        .range(from, to),
    ),
  ]);
  const skip = new Set([...cited.map((row) => row.unit_id), ...held]);
  let candidates = units.filter((unit) => !skip.has(unit.id));
  if (scope.domainId) {
    const root = domains.find((domain) => domain.id === scope.domainId);
    if (!root) throw new Error("The chosen domain no longer exists.");
    const inScope = new Set(
      domains
        .filter(
          (domain) =>
            domain.path === root.path ||
            domain.path.startsWith(`${root.path}/`),
        )
        .map((domain) => domain.id),
    );
    const placed = await readIdBatches(
      candidates.map((unit) => unit.id),
      (batch) =>
        readPages((from, to) =>
          client
            .from("unit_domains")
            .select("unit_id, domain_id")
            .in("unit_id", batch)
            .order("unit_id")
            .order("domain_id")
            .range(from, to),
        ),
    );
    const keep = new Set(
      placed
        .filter((row) => inScope.has(row.domain_id))
        .map((row) => row.unit_id),
    );
    candidates = candidates.filter((unit) => keep.has(unit.id));
  }
  if (scope.unitIds) {
    const keep = new Set(scope.unitIds);
    candidates = candidates.filter((unit) => keep.has(unit.id));
  }
  if (!candidates.length) return [];
  await embedMissingUnits(db, embedder);
  const ids = candidates.map((unit) => unit.id);
  const vectors = new Map<string, number[]>();
  for (let index = 0; index < candidates.length; index += VECTOR_BATCH) {
    for (const [revisionId, vector] of await savedVectors(
      db,
      embedder.model,
      candidates
        .slice(index, index + VECTOR_BATCH)
        .map((unit) => unit.current_revision_id),
    ))
      vectors.set(revisionId, vector);
  }
  const [placements, entities, sources, relationships] = await Promise.all([
    readIdBatches(ids, (batch) =>
      readPages((from, to) =>
        client
          .from("unit_domains")
          .select("unit_id, domain_id")
          .in("unit_id", batch)
          .order("unit_id")
          .order("domain_id")
          .range(from, to),
      ),
    ),
    readIdBatches(ids, (batch) =>
      readPages((from, to) =>
        client
          .from("unit_entities")
          .select("unit_id, entity_id")
          .in("unit_id", batch)
          .neq("role", "mentioned")
          .order("unit_id")
          .order("entity_id")
          .range(from, to),
      ),
    ),
    readIdBatches(ids, (batch) =>
      readPages((from, to) =>
        client
          .from("source_units")
          .select("unit_id, source_id")
          .in("unit_id", batch)
          .order("unit_id")
          .order("source_id")
          .range(from, to),
      ),
    ),
    readIdBatches(ids, (batch) =>
      readPages((from, to) =>
        client
          .from("relationships")
          .select("id, from_unit_id, to_unit_id, type")
          .in("from_unit_id", batch)
          .is("retired_at", null)
          .order("id")
          .range(from, to),
      ),
    ),
  ]);
  const pathById = new Map(domains.map((domain) => [domain.id, domain.path]));
  const byUnit = <T extends { unit_id: string | null }>(
    rows: T[],
    pick: (row: T) => string | null,
  ) => {
    const map = new Map<string, string[]>();
    for (const row of rows) {
      const value = pick(row);
      if (row.unit_id && value)
        map.set(row.unit_id, [...(map.get(row.unit_id) ?? []), value]);
    }
    return map;
  };
  const domainsOf = byUnit(placements, (row) => row.domain_id);
  const entitiesOf = byUnit(entities, (row) => row.entity_id);
  const sourcesOf = byUnit(sources, (row) => row.source_id);
  const groupInput: GroupUnit[] = candidates.flatMap((unit) => {
    const vector = vectors.get(unit.current_revision_id);
    if (!vector) return [];
    const domainIds = domainsOf.get(unit.id) ?? [];
    const roots = domainIds
      .map((id) => pathById.get(id)?.split("/")[0])
      .filter((root): root is string => Boolean(root))
      .sort();
    return [
      {
        id: unit.id,
        revisionId: unit.current_revision_id,
        vector,
        domainIds,
        rootDomainId: roots[0] ?? null,
        entityIds: entitiesOf.get(unit.id) ?? [],
        sourceIds: sourcesOf.get(unit.id) ?? [],
      },
    ];
  });
  const inSet = new Set(ids);
  const citedIds = new Set(cited.flatMap((row) => row.unit_id ?? []));
  const links: GroupLink[] = relationships
    .filter((row) => inSet.has(row.to_unit_id) || citedIds.has(row.to_unit_id))
    .map((row) => ({
      from: row.from_unit_id,
      to: row.to_unit_id,
      type: row.type,
    }));
  const dismissedRows = dismissed.map((row) => ({
    unitIds: row.unit_ids,
    revisionIds: row.revision_ids,
  }));
  if (pass === "merge") {
    if (scope.kind === "create") return [];
    const homes = await articleHomes(
      deps,
      cited,
      groupInput[0]?.vector.length ?? 0,
    );
    return withoutDismissed(likelyMerges(groupInput, links, homes).groups, dismissedRows);
  }
  if (scope.kind === "merge") return [];
  const { groups } = groupUnits(groupInput, links);
  return withoutDismissed(groups, dismissedRows).map((group) => ({
    ...group,
    lane: "leftover" as const,
  }));
}

// One picture per article: a sample of its cited claims, plus domains that mostly belong to it.
async function articleHomes(
  deps: SuggestionDeps,
  cited: readonly { unit_id: string | null; page_id: string | null }[],
  width: number,
): Promise<ArticleHome[]> {
  const byPage = new Map<string, Set<string>>();
  for (const row of cited) {
    if (!row.page_id || !row.unit_id) continue;
    const list = byPage.get(row.page_id) ?? new Set<string>();
    list.add(row.unit_id);
    byPage.set(row.page_id, list);
  }
  if (!byPage.size || !width) return [];
  const sampleIds = [...byPage.values()].flatMap((ids) => [...ids].sort().slice(0, HOME_SAMPLE));
  const citedIds = [...new Set(cited.flatMap((row) => row.unit_id ?? []))];
  const [sampled, domainRows] = await Promise.all([
    readIdBatches(sampleIds, (batch) =>
      readPages((from, to) =>
        deps.client
          .from("units")
          .select("id, current_revision_id")
          .in("id", batch)
          .order("id")
          .range(from, to),
      ),
    ),
    readIdBatches(citedIds, (batch) =>
      readPages((from, to) =>
        deps.client
          .from("unit_domains")
          .select("unit_id, domain_id")
          .in("unit_id", batch)
          .order("unit_id")
          .order("domain_id")
          .range(from, to),
      ),
    ),
  ]);
  const revisionOf = new Map(sampled.map((unit) => [unit.id, unit.current_revision_id]));
  const vectors = new Map<string, number[]>();
  const revisions = [...new Set(sampled.map((unit) => unit.current_revision_id))];
  for (let index = 0; index < revisions.length; index += VECTOR_BATCH) {
    for (const [revisionId, vector] of await savedVectors(
      deps.db,
      deps.embedder.model,
      revisions.slice(index, index + VECTOR_BATCH),
    ))
      vectors.set(revisionId, vector);
  }
  const domainsOf = new Map<string, string[]>();
  for (const row of domainRows) {
    if (!row.unit_id || !row.domain_id) continue;
    domainsOf.set(row.unit_id, [...(domainsOf.get(row.unit_id) ?? []), row.domain_id]);
  }
  const domainPages = new Map<string, Map<string, number>>();
  for (const [pageId, ids] of byPage) {
    for (const unitId of ids) {
      for (const domainId of new Set(domainsOf.get(unitId) ?? [])) {
        const pages = domainPages.get(domainId) ?? new Map<string, number>();
        pages.set(pageId, (pages.get(pageId) ?? 0) + 1);
        domainPages.set(domainId, pages);
      }
    }
  }
  const owned = new Map<string, string[]>();
  for (const [domainId, pages] of domainPages) {
    const total = [...pages.values()].reduce((sum, count) => sum + count, 0);
    for (const [pageId, count] of pages) {
      if (count < 2 || count * 2 <= total) continue;
      owned.set(pageId, [...(owned.get(pageId) ?? []), domainId].sort());
    }
  }
  return [...byPage.keys()].sort().map((pageId) => {
    const ids = [...byPage.get(pageId)!].sort();
    const rows = ids.slice(0, HOME_SAMPLE).flatMap((id) => {
      const vector = vectors.get(revisionOf.get(id) ?? "");
      return vector ? [vector] : [];
    });
    const vector = rows.length
      ? rows[0]!.map((_, index) => rows.reduce((sum, row) => sum + (row[index] ?? 0), 0) / rows.length)
      : new Array<number>(width).fill(0);
    return {
      pageId,
      vector,
      citedIds: ids,
      domainIds: owned.get(pageId) ?? [],
    };
  });
}

type RunContext = {
  charter: SuggestionInput["charter"];
  articles: ArticleIndexEntry[];
  instructions: string;
};
async function suggestionContext(deps: SuggestionDeps): Promise<RunContext> {
  const [charter, articles] = await Promise.all([
    readArticleCharter(deps.db),
    deps.db.call<ArticleIndexEntry[]>("article_index"),
  ]);
  return {
    charter,
    articles,
    instructions: `${skillInstructions(["plan_articles"], deps.settings.skills)}\n${SUGGESTION_PROMPT}`,
  };
}

// The articles nearest a group: its mean vector's nearest cited knowledge, by the articles that cite it
async function closestArticles(
  deps: SuggestionDeps,
  vectors: number[][],
): Promise<CloseArticle[]> {
  if (!vectors.length) return [];
  const centroid = vectors[0]!.map(
    (_, index) =>
      vectors.reduce((sum, vector) => sum + vector[index]!, 0) / vectors.length,
  );
  const near = await similarUnits(
    deps.db,
    deps.embedder.model,
    centroid,
    60,
    0.55,
  );
  if (!near.length) return [];
  const similarity = new Map(
    near.map((unit) => [unit.unitId, unit.similarity]),
  );
  const cites = await readIdBatches(
    near.map((unit) => unit.unitId),
    (batch) =>
      readPages((from, to) =>
        deps.client
          .from("section_knowledge")
          .select("page_id, unit_id")
          .in("unit_id", batch)
          .order("page_id")
          .order("unit_id")
          .range(from, to),
      ),
  );
  const byPage = new Map<string, Set<string>>();
  for (const row of cites)
    if (row.page_id && row.unit_id)
      byPage.set(
        row.page_id,
        (byPage.get(row.page_id) ?? new Set()).add(row.unit_id),
      );
  const ranked = [...byPage]
    .map(([pageId, units]) => {
      const top = [...units]
        .map((id) => similarity.get(id) ?? 0)
        .sort((a, b) => b - a)
        .slice(0, 3);
      return {
        id: pageId,
        closeness: top.reduce((sum, value) => sum + value, 0) / top.length,
      };
    })
    .sort((a, b) => b.closeness - a.closeness || a.id.localeCompare(b.id))
    .slice(0, CLOSEST_ARTICLES);
  return Promise.all(
    ranked.map(async (page) => {
      const { data, error } = await deps.client
        .from("sections")
        .select("id, title")
        .eq("page_id", page.id)
        .is("retired_at", null)
        .order("position");
      if (error) throw new Error(error.message);
      return { ...page, sections: data ?? [] };
    }),
  );
}

// Short enough for every call: the closest articles and their parents, then the most cited
function articleIndexFor(
  articles: ArticleIndexEntry[],
  closest: CloseArticle[],
): ArticleIndexEntry[] {
  if (articles.length <= ARTICLE_INDEX_LIMIT) return articles;
  const keep = new Set(closest.map((page) => page.id));
  for (const article of articles)
    if (keep.has(article.id) && article.parentId) keep.add(article.parentId);
  const rest = articles
    .filter((article) => !keep.has(article.id))
    .sort((a, b) => b.claimCount - a.claimCount)
    .slice(0, ARTICLE_INDEX_LIMIT - keep.size);
  return [...articles.filter((article) => keep.has(article.id)), ...rest];
}

type SuggestionRow = {
  group_key: string;
  kind: "create" | "merge";
  page_id: string | null;
  title: string;
  article_type: "entity" | "process" | "requirement" | "concept" | null;
  entity_id: string | null;
  scope: string;
  rationale: string;
  sections: Json;
  unit_ids: string[];
  revision_ids: string[];
  signals: Json;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
};

async function suggestForGroup(
  deps: SuggestionDeps,
  context: RunContext,
  group: SavedGroup,
  kind?: SuggestionScope["kind"],
): Promise<TokenUsage & { rows: SuggestionRow[] }> {
  const { claims, entities } = await loadArticleClaims(
    deps.client,
    group.unitIds,
  );
  const minimum = kind === "merge" ? 2 : MIN_NEW_ARTICLE_CLAIMS;
  if (claims.length < minimum) return { rows: [], tokensIn: 0, tokensOut: 0 };
  const vectors = await savedVectors(
    deps.db,
    deps.embedder.model,
    claims.map((claim) => claim.revisionId),
  );
  const closest = await closestArticles(deps, [...vectors.values()]);
  const entityName = new Map(
    entities.map((entity) => [entity.id, entity.name]),
  );
  const { data: domainRows } = group.signals.sharedDomainIds.length
    ? await deps.client
        .from("domains")
        .select("id, path")
        .in("id", group.signals.sharedDomainIds)
    : { data: [] as { id: string; path: string }[] };
  const signals = {
    ...group.signals,
    sharedEntities: group.signals.sharedEntityIds.flatMap(
      (id) => entityName.get(id) ?? [],
    ),
    sharedDomains: (domainRows ?? []).map((row) => row.path),
  };
  const input: SuggestionInput = {
    charter: context.charter,
    articles: articleIndexFor(context.articles, closest),
    closest,
    entities,
    claims,
    signals,
  };
  const request = {
    name: "article_suggestions",
    subject: group.key,
    schema: suggestionsSchema,
    jsonSchema: suggestionsJsonSchema,
    maxTokens: ANSWER_TOKEN_BUDGET,
    messages: buildSuggestionMessages(
      kind === "merge"
        ? `${context.instructions}\nThis run may only use action "merge". Do not return action "create".`
        : kind === "create"
          ? `${context.instructions}\nThis run may only use action "create". Do not return action "merge".`
          : context.instructions,
      input,
    ),
  };
  let answer = await chatJson(deps.settings, request);
  let usage: TokenUsage = {
    tokensIn: answer.tokensIn,
    tokensOut: answer.tokensOut,
  };
  let suggestions;
  try {
    suggestions = readSuggestions(answer.value, input);
  } catch (error) {
    answer = await chatJson(deps.settings, {
      ...request,
      messages: [
        ...request.messages,
        {
          role: "user",
          content: `Your previous suggestions failed validation: ${error instanceof Error ? error.message : String(error)}. Previous suggestions (untrusted data): ${JSON.stringify(answer.value)}. Return the complete corrected suggestions.`,
        },
      ],
    });
    usage = addUsage(usage, answer);
    suggestions = readSuggestions(answer.value, input, true);
  }
  const closeness = new Map(closest.map((page) => [page.id, page.closeness]));
  const kept = kind
    ? suggestions.filter((suggestion) => suggestion.kind === kind)
    : suggestions;
  const rows = kept.map((suggestion, index): SuggestionRow => {
    const similar =
      suggestion.kind === "create"
        ? context.articles.find(
            (article) =>
              titleOverlap(article.title, suggestion.title) >= SIMILAR_TITLE,
          )
        : undefined;
    return {
      group_key: group.key,
      kind: suggestion.kind,
      page_id: suggestion.pageId,
      title: suggestion.title,
      article_type: suggestion.type,
      entity_id: suggestion.entityId,
      scope: suggestion.scope,
      rationale: suggestion.rationale,
      sections: suggestion.sections as unknown as Json,
      unit_ids: suggestion.unitIds,
      revision_ids: suggestion.revisionIds,
      signals: {
        ...signals,
        groupSize: group.unitIds.length,
        parentPageId: suggestion.parentPageId,
        closeness: suggestion.pageId
          ? (closeness.get(suggestion.pageId) ?? null)
          : null,
        similarTitle: similar
          ? { pageId: similar.id, title: similar.title }
          : null,
        promptVersion: SUGGESTION_PROMPT_VERSION,
      } as unknown as Json,
      model: answer.model ?? null,
      tokens_in: index ? 0 : usage.tokensIn,
      tokens_out: index ? 0 : usage.tokensOut,
    };
  });
  return { rows, ...usage };
}

// =====================================================================
// APPLY AN ACCEPTED SUGGESTION
// =====================================================================

// Merges into one article must stay in order. Different articles can proceed together.
const pageQueues = new Map<string, Promise<void>>();

function afterPage(key: string, work: () => Promise<void>): Promise<void> {
  const previous = pageQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(work);
  const settled = current.then(
    () => undefined,
    () => undefined,
  );
  pageQueues.set(key, settled);
  void settled.finally(() => {
    if (pageQueues.get(key) === settled) pageQueues.delete(key);
  });
  return current;
}

async function applySuggestion(deps: SuggestionDeps, claim: Claim) {
  const { client } = deps;
  const { data: item, error } = await client
    .from("article_suggestions")
    .select("*")
    .eq("id", claim.id)
    .single();
  if (error) throw new Error(error.message);
  const key =
    item.kind === "merge" && item.page_id
      ? `page:${item.page_id}`
      : `create:${claim.id}`;
  const abort = new AbortController();
  activeApplies.set(claim.id, abort);
  const heartbeat = leaseHeartbeat(
    () => renew(deps.db, claim),
    (failure) => { if (!abort.signal.aborted) abort.abort(failure); },
    APPLY_HEARTBEAT_MS,
  );
  try {
    return await afterPage(key, () =>
      processingCancellation.run(abort.signal, async () => {
        abort.signal.throwIfAborted();
        await renew(deps.db, claim);
        await applyAcceptedSuggestion(deps, claim, item, heartbeat.release);
      }),
    );
  } finally {
    heartbeat.release();
    if (activeApplies.get(claim.id) === abort) activeApplies.delete(claim.id);
  }
}

// Writes the current step onto the suggestion while it is accepting, so the
// suggestions screen can show it. The first step is saved at once; later steps
// are spaced out. settle waits for the last write so a final note is not overwritten.
function applyProgress(client: AdminSupabase, claim: Claim, signals: Json) {
  let chain: Promise<void> = Promise.resolve();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queued: string | undefined;
  let sent = false;
  const base =
    signals && typeof signals === "object" && !Array.isArray(signals)
      ? { ...(signals as Record<string, Json>) }
      : {};
  const doneTitles: string[] = [];
  const doneIds: string[] = [];
  let currentTitle: string | null = null;
  let currentId: string | null = null;
  const write = (text: string) => {
    chain = chain.then(async () => {
      if (closed) return;
      const { error } = await client
        .from("article_suggestions")
        .update({
          note: text,
          signals: {
            ...base,
            progress: {
              doneTitles: [...doneTitles],
              doneIds: [...doneIds],
              currentTitle,
              currentId,
            },
          },
        })
        .eq("id", claim.id)
        .eq("lease_token", claim.token)
        .eq("status", "accepting");
      if (error)
        console.warn("Suggestion progress was not saved:", error.message);
    });
  };
  const queue = (text: string) => {
    if (closed) return;
    if (!sent) {
      sent = true;
      write(text);
      return;
    }
    queued = text;
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      const next = queued;
      queued = undefined;
      if (next) write(next);
    }, 300);
  };
  return {
    report(text: string) {
      queue(text);
    },
    mark(text: string, title: string, state: "done" | "current", id?: string) {
      if (state === "done") {
        if (!doneTitles.includes(title)) doneTitles.push(title);
        if (id && !doneIds.includes(id)) doneIds.push(id);
        if (currentTitle === title) currentTitle = null;
        if (id && currentId === id) currentId = null;
      } else {
        currentTitle = title;
        currentId = id ?? null;
      }
      queue(text);
    },
    async settle() {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
        if (queued) write(queued);
        queued = undefined;
      }
      await chain;
      closed = true;
    },
  };
}

// Section writing already streams to the article. Repeat each step on the suggestion.
// A progress update that fails stays on the suggestion; it does not stop the write.
function writerWithProgress(
  writer: SectionWriter,
  report: (text: string) => void,
): SectionWriter {
  const safely = (run: () => void) => {
    try {
      run();
    } catch (error) {
      console.warn(
        "Suggestion progress was not saved:",
        error instanceof Error ? error.message : error,
      );
    }
  };
  return forwardSectionWriter(writer, {
    progress: (sectionId) => {
      const inner = writer.progress?.(sectionId);
      const step = (text: string) => {
        safely(() => inner?.step(text));
        safely(() => report(text));
      };
      if (!inner)
        return {
          step,
          thinking() {},
          draft() {},
          done() {},
        } satisfies SectionProgress;
      return {
        step,
        thinking: (text) => safely(() => inner.thinking(text)),
        draft: (draft) => safely(() => inner.draft(draft)),
        done: () => safely(() => inner.done()),
      };
    },
  });
}

const trace = {
  modelVersion: null,
  promptVersion: SUGGESTION_PROMPT_VERSION,
  tokensIn: 0,
  tokensOut: 0,
};
const noTarget = { expectedRevisionId: null, passageIds: [], speechAct: null };

function storedQuery(value: Json | null): SectionQuery {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as SectionQuery;
}

// A query without an explicit claim list selects by other filters. Adding
// unitIds would shrink it to only those claims.
function selectsByOtherFilters(query: SectionQuery): boolean {
  if (query.unitIds) return false;
  if (query.domainPaths?.length) return true;
  if (query.entity) return true;
  if (query.kinds?.length) return true;
  return Boolean(query.articleAliases?.length);
}

type MergeProgress = {
  report: (text: string) => void;
  mark: (
    text: string,
    title: string,
    state: "done" | "current",
    id?: string,
  ) => void;
};

// MERGE INTO NAMED SECTIONS ONLY. Existing sections take their claims in one
// save and keep their text. Suggested new sections are added in that same save,
// then written only when they are still empty. The rest of the article is not
// replanned. A retry finds sections an earlier attempt added by title.
async function mergeIntoSections(
  db: DbRpc,
  client: AdminSupabase,
  writer: () => Promise<SectionWriter>,
  pageId: string,
  sections: SuggestedSection[],
  attempt: string,
  progress: MergeProgress,
): Promise<{ attached: number; written: number }> {
  const { data: live, error } = await client
    .from("sections")
    .select("id,title,query,mode")
    .eq("page_id", pageId)
    .is("retired_at", null);
  if (error) throw new Error(error.message);
  const rows = live ?? [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const byTitle = new Map(
    rows.map((row) => [row.title.trim().toLowerCase(), row.id]),
  );
  // A named section that was removed meanwhile falls back to a same-title section, or a new one
  const resolved = sections.map((section) => ({
    ...section,
    sectionId:
      (section.sectionId && byId.has(section.sectionId)
        ? section.sectionId
        : byTitle.get(section.title.trim().toLowerCase())) ?? null,
  }));
  const toCreate = resolved.filter((section) => !section.sectionId);
  const actions: DraftAction[] = toCreate.map(
    (section): DraftAction => ({
      ...noTarget,
      targetId: null,
      type: "create_section",
      input: {
        pageId,
        title: section.title,
        query: { unitIds: section.unitIds, article: true },
      },
    }),
  );
  let attached = 0;
  for (const section of resolved) {
    if (!section.sectionId || toCreate.includes(section)) continue;
    const row = byId.get(section.sectionId);
    if (!row) continue;
    if (row.mode !== "generated")
      throw new Error(`Could not attach the claims to "${row.title}".`);
    const query = storedQuery(row.query);
    if (selectsByOtherFilters(query))
      throw new Error(`Could not attach the claims to "${row.title}".`);
    const have = new Set(query.unitIds ?? []);
    const adding = section.unitIds.filter((id) => !have.has(id));
    if (!adding.length) continue;
    const next: SectionQuery = {
      ...query,
      unitIds: [...(query.unitIds ?? []), ...adding],
    };
    actions.push({
      ...noTarget,
      targetId: section.sectionId,
      type: "update_section_query",
      input: { query: next, fromQuery: row.query },
    });
    attached += adding.length;
  }
  // One save places every claim. The old path saved each section on its own.
  if (actions.length) {
    progress.report(
      toCreate.length
        ? `Adding ${toCreate.length} new section(s) and placing the claims…`
        : "Placing the claims on the existing sections…",
    );
    const { changeSetId } = await submitChangeSet(
      db,
      {
        eventId: null,
        cause: "edit",
        actor: "ai",
        operationKey: `suggestion-merge:${attempt}`,
      },
      {
        summary: toCreate.length
          ? `Added ${toCreate.length} section(s) and placed claims from an accepted suggestion`
          : `Placed ${attached} claim(s) from an accepted suggestion`,
        actions,
        trace,
      },
    );
    const result = await commitChangeSet(db, changeSetId);
    if (result.status === "rejected" || result.rejected > 0)
      throw new Error(
        `The claims could not be placed. Review change set ${changeSetId} in Changes.`,
      );
    if (toCreate.length) {
      const { data: created, error: createdError } = await client
        .from("actions")
        .select("target_id")
        .eq("change_set_id", changeSetId)
        .eq("type", "create_section")
        .eq("outcome", "applied")
        .order("position");
      if (createdError) throw new Error(createdError.message);
      toCreate.forEach((section, index) => {
        section.sectionId = created?.[index]?.target_id ?? null;
      });
      if (toCreate.some((section) => !section.sectionId))
        throw new Error("A new section is waiting in Exceptions.");
    }
  }
  const existingIds = resolved.flatMap((section) =>
    section.sectionId && !toCreate.includes(section) ? [section.sectionId] : [],
  );
  const alreadyWritten = new Set<string>();
  if (existingIds.length) {
    const { data: lines, error: linesError } = await client
      .from("section_lines")
      .select("section_id, content")
      .in("section_id", existingIds);
    if (linesError) throw new Error(linesError.message);
    for (const line of lines ?? []) {
      if (line.section_id && line.content?.trim())
        alreadyWritten.add(line.section_id);
    }
  }
  // Write only a section that has no text yet. A section that already reads stays as it is.
  let written = 0;
  let sectionWriter: SectionWriter | null = null;
  for (const section of resolved) {
    const id = section.sectionId!;
    if (alreadyWritten.has(id)) {
      progress.mark(`“${section.title}” is in place.`, section.title, "done", id);
      continue;
    }
    progress.mark(`Writing “${section.title}”…`, section.title, "current", id);
    sectionWriter ??= writerWithProgress(await writer(), progress.report);
    try {
      // A person accepted these claims for this section, so the editorial pick cannot drop them.
      const built = await rebuildUploadSection(db, sectionWriter, id, null, {
        skipEditorialReview: true,
      });
      if (!built || built.rebuildRequested)
        throw new Error(
          `“${section.title}” is still being written. Retry when it finishes.`,
        );
      const after = await db.call<SectionState>("read_section_state", {
        p_section_id: id,
      });
      if (!after.lines.some((line) => line.content.trim()))
        throw new Error(`“${section.title}” came back with no text.`);
    } catch (writeError) {
      // An empty section must not stay on the article. Its claims go back to unused.
      if (toCreate.includes(section))
        await retireEmptySection(db, id, attempt).catch((failure) =>
          console.warn(
            "An empty suggested section could not be removed:",
            failure instanceof Error ? failure.message : failure,
          ),
        );
      throw writeError;
    }
    written += 1;
    progress.mark(`Wrote “${section.title}”.`, section.title, "done", id);
  }
  return { attached, written };
}

async function livePageTitled(client: AdminSupabase, title: string) {
  const key = title.trim().toLowerCase();
  const { data, error } = await client
    .from("pages")
    .select("id,title")
    .ilike("title", `%${key.replace(/[%_\\]/g, "\\$&")}%`)
    .is("retired_at", null)
    .eq("kind", "article");
  if (error) throw new Error(error.message);
  return (
    (data ?? []).find((page) => page.title.trim().toLowerCase() === key)?.id ??
    null
  );
}

async function retireEmptySection(
  db: DbRpc,
  sectionId: string,
  attempt: string,
) {
  const { changeSetId } = await submitChangeSet(
    db,
    {
      eventId: null,
      cause: "edit",
      actor: "ai",
      operationKey: `suggestion-retire-empty:${attempt}:${sectionId}`,
    },
    {
      summary: "Removed a suggested section that was not written",
      actions: [
        { ...noTarget, targetId: sectionId, type: "retire_section", input: {} },
      ],
      trace,
    },
  );
  await commitChangeSet(db, changeSetId);
}

async function applyAcceptedSuggestion(
  deps: SuggestionDeps,
  claim: Claim,
  item: Tables<"article_suggestions">,
  releaseLease: () => void,
) {
  const { db, client } = deps;
  const progress = applyProgress(client, claim, item.signals);
  const finish = async (patch: {
    status: "applied" | "stale" | "failed";
    note: string | null;
    result_page_id?: string | null;
    signals?: Json;
  }) => {
    await progress.settle();
    // This write clears the lease, and a new article goes on writing after it
    releaseLease();
    const { data, error: saveError } = await client
      .from("article_suggestions")
      .update({ ...patch, lease_token: null, lease_until: null })
      .eq("id", claim.id)
      .eq("lease_token", claim.token)
      .select("id");
    if (saveError) throw new Error(saveError.message);
    if (!data?.length) throw new LeaseLost();
  };
  progress.report("Checking the knowledge still matches this suggestion…");
  try {
    // Re-check against today's knowledge: drop units that changed, retired or got cited meanwhile
    const [units, cited] = await Promise.all([
      readIdBatches(item.unit_ids, (batch) =>
        readPages((from, to) =>
          client
            .from("units")
            .select("id, current_revision_id")
            .in("id", batch)
            .is("retired_at", null)
            .order("id")
            .range(from, to),
        ),
      ),
      // Which of these claims already sit on an article. This does not load article text.
      db.call<string[]>("placed_unit_ids", { p_unit_ids: item.unit_ids }),
    ]);
    const expected = new Map(
      item.unit_ids.map((id, index) => [id, item.revision_ids[index]]),
    );
    const citedIds = new Set(Array.isArray(cited) ? cited : []);
    const current = new Set(
      units
        .filter(
          (unit) =>
            expected.get(unit.id) === unit.current_revision_id &&
            !citedIds.has(unit.id),
        )
        .map((unit) => unit.id),
    );
    const sections = (item.sections as unknown as SuggestedSection[])
      .map((section) => ({
        ...section,
        unitIds: section.unitIds.filter((id) => current.has(id)),
      }))
      .filter((section) => section.unitIds.length);
    const kept = sections.flatMap((section) => section.unitIds).length;
    const dropped = item.unit_ids.length - kept;
    const droppedNote = dropped
      ? ` ${dropped} unit(s) were left out because they changed or an article cites them now.`
      : "";
    if (item.kind === "create" ? kept < MIN_NEW_ARTICLE_CLAIMS : kept < 1) {
      return finish({
        status: "stale",
        note: `The knowledge changed since this was suggested.${droppedNote} Run suggestions again.`,
      });
    }
    // Page titles are unique, so a new article whose title is taken merges into that page.
    const sameTitle =
      item.kind === "create" ? await livePageTitled(client, item.title) : null;
    if (item.kind === "merge" || sameTitle) {
      const pageId = sameTitle ?? item.page_id!;
      const { data: page } = await client
        .from("pages")
        .select("id")
        .eq("id", pageId)
        .is("retired_at", null)
        .maybeSingle();
      if (!page)
        return finish({
          status: "stale",
          note: "The article this would merge into no longer exists.",
        });
      progress.report("Attaching the claims to the named sections…");
      const { attached, written } = await mergeIntoSections(
        db,
        client,
        deps.writer,
        pageId,
        sections,
        claim.token,
        progress,
      );
      const parts = [
        sameTitle
          ? `An article called “${item.title}” already existed, so the claims went into it.`
          : null,
        attached ? `Attached ${attached} claim(s) to existing sections.` : null,
        written ? `Wrote ${written} new section(s).` : null,
        "The rest of the article was left as it is.",
      ].filter(Boolean);
      return finish({
        status: "applied",
        note: `${parts.join(" ")}${droppedNote}`,
        result_page_id: pageId,
      });
    }
    const baseWriter = await deps.writer();
    progress.report("Creating the article…");
    const signals = (item.signals ?? {}) as { parentPageId?: string | null };
    const parent = signals.parentPageId
      ? ((
          await client
            .from("pages")
            .select("id")
            .eq("id", signals.parentPageId)
            .is("retired_at", null)
            .maybeSingle()
        ).data?.id ?? null)
      : null;
    const actions: DraftAction[] = [
      {
        targetId: null,
        expectedRevisionId: null,
        passageIds: [],
        speechAct: null,
        type: "create_page",
        input: {
          title: item.title,
          entityId: item.entity_id,
          articleType: item.article_type ?? "concept",
          scope: item.scope,
          parentPageId: parent,
          sections: sections.map((section) => ({
            title: section.title,
            query: { unitIds: section.unitIds, article: true },
          })),
        },
      },
    ];
    const { changeSetId } = await submitChangeSet(
      db,
      {
        eventId: null,
        cause: "edit",
        actor: "ai",
        operationKey: `article-suggestion:${item.id}`,
      },
      {
        summary: `Created the article “${item.title}” from an accepted suggestion`,
        actions,
        trace: {
          modelVersion: item.model,
          promptVersion: SUGGESTION_PROMPT_VERSION,
          tokensIn: 0,
          tokensOut: 0,
        },
      },
    );
    const result = await commitChangeSet(db, changeSetId);
    if (result.status === "rejected" || result.rejected > 0)
      return finish({
        status: "failed",
        note: `The article was not created. Review change set ${changeSetId} in Changes.`,
      });
    const { data: created, error: createdError } = await client
      .from("actions")
      .select("target_id")
      .eq("change_set_id", changeSetId)
      .eq("type", "create_page")
      .eq("outcome", "applied")
      .maybeSingle();
    if (createdError) throw new Error(createdError.message);
    const pageId = created?.target_id ?? null;
    if (!pageId)
      return finish({
        status: "failed",
        note: "The article is waiting in Exceptions before it is created.",
      });
    // Saved first: the article exists even if writing its text stops part way.
    // signals.writing keeps the card open until the text is written.
    const base =
      item.signals &&
      typeof item.signals === "object" &&
      !Array.isArray(item.signals)
        ? (item.signals as Record<string, Json>)
        : {};
    await finish({
      status: "applied",
      note: "Writing the article…",
      result_page_id: pageId,
      signals: { ...base, writing: true },
    });
    const live = await readArticleStructure(db, pageId);
    await saveArticleStructure(db, {
      pageId,
      key: `initial:article-suggestion:${item.id}`,
      structure: live.current,
      changes: { created: true },
      rationale:
        "The accepted suggestion's outline assigns the knowledge before the article is written.",
      model: item.model,
    });
    const { data: pageSections, error: sectionsError } = await client
      .from("sections")
      .select("id,title")
      .eq("page_id", pageId)
      .is("retired_at", null);
    if (sectionsError) throw new Error(sectionsError.message);
    const titleOf = new Map(
      (pageSections ?? []).map((row) => [row.id, row.title]),
    );
    const doneTitles: string[] = [];
    let currentTitle: string | null = null;
    let saved: Promise<unknown> = Promise.resolve();
    // Queued so a late progress write cannot land over the final state.
    const save = (patch: { note: string | null; writing: boolean }) => {
      const signals = {
        ...base,
        writing: patch.writing,
        progress: { doneTitles: [...doneTitles], currentTitle },
      };
      saved = saved.then(() =>
        client
          .from("article_suggestions")
          .update({ note: patch.note, signals })
          .eq("id", item.id)
          .eq("status", "applied"),
      );
      return saved;
    };
    let lastNote: string | null = "Writing the article…";
    const writer = writerWithProgress(baseWriter, (text) => {
      lastNote = text;
      void save({ note: text, writing: true });
    });
    const writing = forwardSectionWriter(writer, {
      progress: (sectionId) => {
        const inner = writer.progress?.(sectionId);
        currentTitle = titleOf.get(sectionId) ?? null;
        void save({ note: lastNote, writing: true });
        return {
          step: (text) => inner?.step(text),
          thinking: (text) => inner?.thinking(text),
          draft: (draft) => inner?.draft(draft),
          done: () => {
            inner?.done();
            const title = titleOf.get(sectionId);
            if (title && !doneTitles.includes(title)) doneTitles.push(title);
            if (currentTitle === title) currentTitle = null;
            void save({ note: lastNote, writing: true });
          },
        } satisfies SectionProgress;
      },
    });
    try {
      await rebuildPage(db, writing, pageId);
      currentTitle = null;
      await save({ note: droppedNote.trim() || null, writing: false });
    } catch (writeError) {
      currentTitle = null;
      // The error can come after the last section is written; check the article before blaming it.
      const states = await Promise.all(
        [...titleOf.keys()].map((id) =>
          db
            .call<SectionState>("read_section_state", { p_section_id: id })
            .catch(() => null),
        ),
      );
      const written = states.every((state) =>
        state?.lines.some((line) => line.content.trim()),
      );
      const reason =
        writeError instanceof Error
          ? writeError.message || writeError.name
          : String(writeError);
      await save({
        note: written
          ? droppedNote.trim() || null
          : `Created, but its text is not fully written: ${reason || "the writer stopped"}. Open the article to rebuild it.`,
        writing: false,
      });
    }
  } finally {
    await progress.settle();
  }
}
