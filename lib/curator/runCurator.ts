import "server-only";
import { after } from "next/server";
import { requireUser } from "@/lib/auth/requireUser";
import { getServerDeps } from "@/lib/server/deps";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import { readArticleCharter, readModelChoice } from "@/lib/ai/models";
import { loadRoleInstructions } from "@/lib/ai/skills/server";
import { CURATOR_INSTRUCTIONS } from "@/lib/ai/rolePolicies";
import { type AutoAccepted, commitAsRole, submitChangeSet } from "@/lib/change-control";
import { rebuildSection, type SectionWriter } from "@/lib/living-page";
import { type DbRpc, supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { toActionResult } from "@/lib/server-actions/result";
import { CURATOR_PROMPT_VERSION, curate, lostClaims, type CuratorSnapshot } from "./curate";
import { changeToAction, describeChange, type Dispatch } from "./plan";
import type { TreeHealth } from "./score";
import type { CuratorScope } from "./scope";
import { uploadExecution, workflowStep } from "@/lib/ingest/workflowContext";

// =====================================================================
// RUN THE CURATOR ON THE LIVE WIKI: one pass over the whole page tree. Each
// change is its own AI ChangeSet; merges, moves and unsure changes wait in
// Exceptions, confident renames and types apply (undoable in Changes).
// =====================================================================

// mergedSectionIds: sections that merges accepted in full auto added to a page; their lines still need writing
// dispatches: work the Curator handed to other roles (the caller runs it: it takes minutes)
export type CuratorRunResult = { summary: string; proposed: number; applied: number; exceptions: number; skipped: number; before: TreeHealth; after: TreeHealth; mergedSectionIds: string[]; dispatches: Dispatch[]; affectedPageIds: string[] };

// From the Pages sidebar: a signed-in person starts it. Organization pages that the
// changes left repeating their children are re-planned as overviews after the response.
export async function runCurator(progress: (detail: string) => void = () => {}) {
  return toActionResult<CuratorRunResult>(async () => {
    await requireUser();
    const result = await runCuratorPass(supabaseRpc(getAdminSupabase()), progress);
    const deps = await getServerDeps();
    // After the response: merged sections, then overviews, then the work handed to other roles
    after(() => writeMergedSections(deps.db, deps.writer, result.mergedSectionIds)
      .then(() => deps.pageMaintainer?.(null, { curate: false, dispatches: result.dispatches }))
      .then(() => undefined).catch((error) => console.error("Upkeep after a Curator run failed:", error)));
    return result;
  });
}

// One pass, saved through change control (callers check who may start it)
export async function runCuratorPass(db: DbRpc, progress: (detail: string) => void = () => {}, options: { scope?: CuratorScope } = {}): Promise<CuratorRunResult> {
  progress("Loading every page and the claims it cites…");
  const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db), (call) => db.call("log_ai_call", { p_call: { ...call, role: "curator" } }));
  if (!settings) throw new Error("Configure an AI provider in Settings before curating pages.");
  const snapshot = await workflowStep("curator:snapshot", () => db.call<CuratorSnapshot>("curator_snapshot"));
  const instructions = (await loadRoleInstructions(db)).find((row) => row.role === "curator")?.instructions ?? CURATOR_INSTRUCTIONS;
  const pass = await workflowStep("curator:plan", async () => curate(settings, snapshot, { charter: await readArticleCharter(db), instructions, onProgress: progress, scope: options.scope }));
  // Safety: a run never drops a claim from every page
  const lost = lostClaims(snapshot.pages, pass.pagesAfter);
  if (lost.length) throw new Error(`The proposed changes would leave ${lost.length} claim(s) on no page. Nothing was saved.`);

  progress(`Saving ${pass.changes.length} change(s)…`);
  const titles = new Map(snapshot.pages.map((page) => [page.id, page.title]));
  const title = (id: string) => titles.get(id) ?? "a page";
  let applied = 0, exceptions = 0;
  const autoAccepted: AutoAccepted[] = [];
  for (const [index, change] of pass.changes.entries()) {
    // The one model call's usage is recorded once, on the first change
    const draft = { summary: describeChange(change, title), actions: [changeToAction(change, title)],
      trace: { modelVersion: pass.model, promptVersion: CURATOR_PROMPT_VERSION, tokensIn: index ? 0 : pass.tokensIn, tokensOut: index ? 0 : pass.tokensOut } };
    const { changeSetId } = await submitChangeSet(db, { eventId: null, cause: "edit", actor: "ai", operationKey: uploadExecution.getStore() ? `curator:change:${index}` : `curator:${crypto.randomUUID()}` }, draft);
    const result = await workflowStep(`curator:commit:${index}`, async () => {
      const committed = await commitAsRole(db, "curator", changeSetId);
      if (committed.status === "rejected" || committed.rejected > 0) throw new Error(`Curator change was not fully applied. Review change set ${changeSetId} in Changes.`);
      return committed;
    });
    applied += result.applied + result.autoAccepted.length;
    exceptions += result.exceptions;
    autoAccepted.push(...result.autoAccepted);
  }
  return { summary: pass.answer?.summary ?? "Nothing was flagged, so the page tree was left as it is.", proposed: pass.changes.length, applied, exceptions,
    skipped: pass.skipped.length, before: pass.before, after: pass.after, mergedSectionIds: await mergedSections(autoAccepted), dispatches: pass.dispatches,
    affectedPageIds: [...new Set(pass.changes.flatMap((change) => [change.pageId,
      ...(change.operation === "merge" ? [change.intoPageId] : []),
      ...(change.operation === "group" ? change.pageIds : []),
      ...((change.operation === "move" || change.operation === "group") && change.parentPageId ? [change.parentPageId] : []),
    ]))] };
}

// An accepted merge records the section it added to the page that stays (as answering it on Exceptions does)
async function mergedSections(accepted: AutoAccepted[]): Promise<string[]> {
  const actionIds = accepted.filter((item) => item.reason === "page_structure_review").map((item) => item.actionId);
  if (!actionIds.length) return [];
  const { data, error } = await getAdminSupabase().from("actions").select("undo_state").in("id", actionIds);
  if (error) throw new Error(error.message);
  return data.flatMap((row) => (row.undo_state as { sectionId?: string | null } | null)?.sectionId ?? []);
}

// Writes the lines of the sections full-auto merges added
export async function writeMergedSections(db: DbRpc, writer: SectionWriter | undefined, sectionIds: string[]): Promise<void> {
  if (!writer) return;
  for (const sectionId of sectionIds) await rebuildSection(db, writer, sectionId, null, false);
}
