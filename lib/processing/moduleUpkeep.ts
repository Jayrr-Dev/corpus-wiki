import type { PipelineDeps } from "@/lib/ingest/pipeline";
import { uploadExecution, workflowStep } from "@/lib/ingest/workflowContext";
import { holdForReviewerBudget, proposePages, rebuildAfterEvent } from "@/lib/living-page";

// =====================================================================
// MODULE UPKEEP: an upload saves knowledge only (lib/ingest/workflow.ts)
// and hands its event to the modules (module_upkeep). Each module brings
// itself up to date from it here, on the background worker, in order:
//   definitions  the Glossary's Definer explains key terms (new claims)
//   wiki         plan, write and review articles, file new pages
//   entities     descriptions and stakeholder cards
//   glossary     dictionary entries
//   curator      the page tree
// A running item holds a lease on its upload (20261130100000_module_upkeep.sql),
// so its steps save checkpoints a retry resumes from, a large article build
// waits for the Reviewer budget approval, and Cancel stops it.
// =====================================================================

export const UPKEEP_MODULES = ["definitions", "wiki", "entities", "glossary", "curator"] as const;
export type UpkeepModule = (typeof UPKEEP_MODULES)[number];
export type UpkeepStatus = Partial<Record<UpkeepModule, { waiting: number; working: number; failed: number; cancelled: number; error: string | null }>>;

type ClaimedItem = { id: string; eventId: string; module: UpkeepModule; token: string };
type Outcome = "done" | "waiting";

// How often a running item renews its lease (it lasts 10 minutes) and so how soon a Cancel stops its AI call
const RENEW_MS = 15_000;

// What one module does with one upload's knowledge. Runs inside the item's lease.
export async function runModuleForEvent(deps: PipelineDeps, module: UpkeepModule, eventId: string): Promise<Outcome> {
  const step = (key: string, run: () => Promise<unknown>) => workflowStep(`module:${module}:${key}`, run);
  switch (module) {
    case "definitions":
      await step("expand", async () => deps.knowledgeExpander?.(eventId));
      // New definitions are claims: index them so the Wiki finds them by meaning
      await step("embeddings", async () => deps.claimEmbedder?.());
      return "done";
    case "wiki":
      await step("plan", async () => {
        const refreshed = await proposePages(deps.db, eventId, deps.pagePlanner);
        await deps.articleOrchestrator?.(eventId);
        return refreshed;
      });
      // A very large build waits for a person to approve its Reviewer calls (lib/living-page/reviewerBudget.ts);
      // a decline throws and fails the item with the reason
      if (await holdForReviewerBudget(deps.db, eventId)) return "waiting";
      await step("pages", async () => {
        await rebuildAfterEvent(deps.db, deps.writer, eventId);
        // New articles cite their claims only once written: file them under their context now
        if (deps.articleOrchestrator) await deps.hierarchyOrganizer?.(eventId);
      });
      await step("verify", async () => deps.articleVerifier?.(eventId));
      return "done";
    case "entities":
      await step("describe", async () => deps.entityDescriber?.(eventId));
      await step("profiles", async () => deps.profileWriter?.(eventId));
      return "done";
    case "glossary":
      await step("glossary", async () => deps.glossaryGenerator?.());
      return "done";
    case "curator":
      await step("curate", async () => deps.pageMaintainer?.(eventId));
      return "done";
  }
}

// One item: run under its lease, renew it while working, abort the work if it is cancelled
async function runItem(deps: PipelineDeps, item: ClaimedItem): Promise<void> {
  const abort = new AbortController();
  const renew = setInterval(() => {
    void deps.db.call<boolean>("renew_module_upkeep", { p_id: item.id, p_token: item.token })
      .then((owned) => { if (!owned) abort.abort(new Error("Processing was cancelled.")); })
      .catch(() => {});
  }, RENEW_MS);
  renew.unref?.();
  let error: string | null = null;
  let outcome: Outcome = "done";
  try {
    outcome = await uploadExecution.run({ eventId: item.eventId, token: item.token, db: deps.db, signal: abort.signal },
      () => runModuleForEvent(deps, item.module, item.eventId));
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    console.error(`Module upkeep (${item.module}) failed`, { eventId: item.eventId, error });
  } finally {
    clearInterval(renew);
    await deps.db.call("finish_module_upkeep", { p_id: item.id, p_token: item.token, p_error: error, p_waiting: outcome === "waiting" && !error });
  }
}

// One pass for the current space: each module takes its next ready upload, in module order,
// until nothing is ready or the budget is spent. True when any item was worked on.
// An item already started runs to its end; the budget only stops new ones.
export async function runModuleUpkeep(deps: PipelineDeps, budgetMs: number): Promise<boolean> {
  const startedAt = Date.now();
  let worked = false;
  for (;;) {
    let progressed = false;
    for (const upkeepModule of UPKEEP_MODULES) {
      if (Date.now() - startedAt > budgetMs) return worked;
      const item = await deps.db.call<ClaimedItem | null>("claim_module_upkeep", { p_module: upkeepModule });
      if (!item) continue;
      progressed = worked = true;
      await runItem(deps, item);
    }
    if (!progressed) return worked;
  }
}
