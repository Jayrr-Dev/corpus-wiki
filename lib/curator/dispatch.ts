import "server-only";
import type { Embedder } from "@/lib/ai/embeddings";
import { readAllowExternalKnowledge } from "@/lib/ai/models";
import type { DraftAction } from "@/lib/ai/types";
import { commitChangeSet, submitChangeSet } from "@/lib/change-control";
import { webSearchKey } from "@/lib/knowledge/webSearch";
import { rebuildPage } from "@/lib/living-page";
import { orchestrateClaims } from "@/lib/living-page/articleOrchestrator";
import { discoverArticleUpdates } from "@/lib/living-page/discoverArticleUpdates";
import { forceCreateSection, NoSectionKnowledgeError } from "@/lib/living-page/forceCreateSection";
import { refreshOrganizationOverviews, type OverviewDeps } from "@/lib/living-page/refreshOrganizationOverviews";
import { runPageReview } from "@/lib/living-page/runPageReview";
import type { Dispatch, PageDispatch } from "./plan";
import { uploadExecution, workflowStep } from "@/lib/ingest/workflowContext";
import { createHash } from "node:crypto";

// =====================================================================
// CURATOR DISPATCH: the Curator hands one page to another role, which does
// the work through its own entry point and its own ChangeSets (so the work
// is audited and undoable as if a person had asked for it).
//   reviewer   — page review: polishes wording, takes out repeated or unsupported lines
//   planner    — adds stored claims the page is missing, including the claims no page
//                cites that the scores filed under it (or re-plans an overview)
//   researcher — builds out one missing section from stored knowledge, and the
//                web when Settings allow it
//   proposer   — the Article Proposer and Reviewer (as after an upload) on the
//                stored claims that fit no page: new articles, or sections of old ones
// One failure never stops the others; each outcome is reported.
// =====================================================================

export type DispatchDeps = OverviewDeps & { embedder?: Embedder | null };
export type DispatchOutcome = Dispatch & { status: "done" | "nothing" | "failed"; detail: string };

const NO_PERSON: Pick<DraftAction, "expectedRevisionId" | "passageIds" | "speechAct"> = { expectedRevisionId: null, passageIds: [], speechAct: null };

// Checkpoints pass through jsonb, which reorders object keys. An intent must
// keep its identity after that round trip or resume can submit a second edit.
function intentHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value, (_key, part) =>
    part && typeof part === "object" && !Array.isArray(part)
      ? Object.fromEntries(Object.entries(part).sort(([a], [b]) => a.localeCompare(b))) : part)).digest("hex");
}

async function commitAi(deps: DispatchDeps, summary: string, actions: DraftAction[], promptVersion: string): Promise<string> {
  const intent = intentHash({ summary, actions });
  const { changeSetId } = await submitChangeSet(deps.db, { eventId: null, cause: "edit", actor: "ai", operationKey: `dispatch:${uploadExecution.getStore() ? intent : crypto.randomUUID()}` }, {
    summary, actions, trace: { modelVersion: deps.settings.model ?? null, promptVersion, tokensIn: null, tokensOut: null },
  });
  const result = await commitChangeSet(deps.db, changeSetId);
  if (result.status === "rejected" || result.rejected > 0) throw new Error("Change control rejected the change.");
  return changeSetId;
}

// REVIEWER: the page review a person starts with "Review page"
async function review(deps: DispatchDeps, dispatch: PageDispatch): Promise<string> {
  await runPageReview(deps.db, deps.settings, dispatch.pageId, deps.embedder ?? null, undefined, dispatch.note);
  return "Reviewed the page with the Curator's focus.";
}

// PLANNER: an organization or placeholder page gets its overview re-planned; any other page
// gains sections for stored claims that belong on it ("Update" on the page)
async function plan(deps: DispatchDeps, dispatch: PageDispatch): Promise<string | null> {
  const overview = await refreshOrganizationOverviews(deps, null, { pageIds: [dispatch.pageId] });
  if (overview.length) {
    const outcome = overview[0]!;
    if (outcome.status === "failed") throw new Error(outcome.detail ?? "The overview failed.");
    return outcome.status === "applied" ? "Re-planned the overview." : outcome.detail;
  }
  const key = intentHash(dispatch);
  const { sections } = await workflowStep(`dispatch:plan:${key}`, () => discoverArticleUpdates(deps.db, deps.client, deps.settings, dispatch.pageId, dispatch.note, dispatch.claimIds));
  if (!sections.length) return null;
  await commitAi(deps, `Planner (for the Curator): added ${sections.length} section(s) of stored knowledge`,
    sections.map((section): DraftAction => ({ ...NO_PERSON, type: "create_section", targetId: null, input: { pageId: dispatch.pageId, ...section } })), "curator-dispatch-planner-v1");
  if (deps.writer) await rebuildPage(deps.db, deps.writer, dispatch.pageId);
  return `Added ${sections.length} section(s).`;
}

// RESEARCHER: a new section under the heading, filled by Force Create; removed again when nothing fits
async function research(deps: DispatchDeps, dispatch: PageDispatch): Promise<string | null> {
  if (!deps.writer) throw new Error("No section writer is configured.");
  const changeSetId = await commitAi(deps, `Researcher (for the Curator): started “${dispatch.heading}”`,
    [{ ...NO_PERSON, type: "create_section", targetId: null, input: { pageId: dispatch.pageId, title: dispatch.heading!, query: { unitIds: [], article: true } } }], "curator-dispatch-researcher-v1");
  const { data: created, error } = await deps.client.from("actions").select("target_id").eq("change_set_id", changeSetId).eq("type", "create_section").single();
  if (error || !created.target_id) throw new Error(error?.message ?? "The new section was not recorded.");
  const useWeb = await readAllowExternalKnowledge(deps.db);
  try {
    const filled = await forceCreateSection({ db: deps.db, client: deps.client, settings: deps.settings, writer: deps.writer, webSearchKey: webSearchKey() }, created.target_id, dispatch.note, useWeb, true);
    return `Built “${dispatch.heading}” from ${filled.internal} stored and ${filled.external} web claim(s).`;
  } catch (fillError) {
    // Provider, database and writer failures leave the section available for
    // resume. Only a successful search with no fitting knowledge removes it.
    if (!(fillError instanceof NoSectionKnowledgeError)) throw fillError;
    await commitAi(deps, `Researcher (for the Curator): removed the empty “${dispatch.heading}”`,
      [{ ...NO_PERSON, type: "retire_section", targetId: created.target_id, input: {} }], "curator-dispatch-researcher-v1");
    return null;
  }
}

// PROPOSER: new articles for knowledge no page holds; the pages it touched get their lines written
async function propose(deps: DispatchDeps, dispatch: Dispatch): Promise<string | null> {
  const result = await orchestrateClaims({ settings: deps.settings, client: deps.client, db: deps.db, embedder: deps.embedder ?? null }, dispatch.claimIds);
  // The articles are saved; one page's failed rebuild is reported, never the whole job's failure
  const unwritten: string[] = [];
  if (deps.writer) for (const pageId of result.pageIds) {
    try { await rebuildPage(deps.db, deps.writer, pageId); }
    catch (error) { unwritten.push(error instanceof Error ? error.message : String(error)); }
  }
  const done = result.created + result.updated + result.sections;
  const problems = unwritten.length ? ` ${unwritten.length} page(s) not fully rebuilt: ${unwritten.join("; ")}` : "";
  if (unwritten.length) throw new Error(problems.trim());
  return done ? `${result.created} new article(s), ${result.updated + result.sections} existing article(s) extended, ${result.rejected} proposal(s) turned down.${problems}` : null;
}

export async function runDispatches(deps: DispatchDeps, dispatches: readonly Dispatch[]): Promise<DispatchOutcome[]> {
  const outcomes: DispatchOutcome[] = [];
  for (const dispatch of dispatches) {
    try {
      const key = intentHash(dispatch);
      const detail = await workflowStep(`curator:dispatch:${key}`, () => dispatch.role === "proposer" ? propose(deps, dispatch)
        : dispatch.role === "reviewer" ? review(deps, dispatch) : dispatch.role === "planner" ? plan(deps, dispatch) : research(deps, dispatch));
      outcomes.push({ ...dispatch, status: detail ? "done" : "nothing", detail: detail ?? "Nothing to add." });
    } catch (error) {
      outcomes.push({ ...dispatch, status: "failed", detail: error instanceof Error ? error.message : String(error) });
    }
  }
  return outcomes;
}
