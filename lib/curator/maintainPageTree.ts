import "server-only";
import { refreshOrganizationOverviews, type OverviewOutcome } from "@/lib/living-page/refreshOrganizationOverviews";
import { runCuratorPass, type CuratorRunResult, writeMergedSections } from "./runCurator";
import { type DispatchDeps, type DispatchOutcome, runDispatches } from "./dispatch";
import type { Dispatch } from "./plan";
import { processingSpan } from "@/lib/processing/metrics";
import type { SectionRef } from "@/lib/living-page/types";
import type { CuratorScope } from "./scope";
import { workflowStep } from "@/lib/ingest/workflowContext";

// =====================================================================
// PAGE TREE UPKEEP: what runs on its own after anything reshapes the wiki
// (an upload's articles step, a Curator run, an accepted Curator change).
//   1. the Curator merges, moves, renames and types pages (AI only when the
//      scores flag something; structural changes wait in Exceptions)
//   2. the Planner turns any organization page that now repeats the pages
//      under it, and any new placeholder page, into an overview (AI only for such pages)
//   3. the work the Curator handed to other roles runs (at most five pages)
// Event-driven, not on a timer: these are the only things that change the tree.
// =====================================================================

// dispatches: work from a Curator pass the caller already ran (curate: false)
export async function maintainPageTree(deps: DispatchDeps, eventId: string | null, options: { curate?: boolean; dispatches?: Dispatch[] } = {}): Promise<{ curator: CuratorRunResult | null; overviews: OverviewOutcome[]; dispatched: DispatchOutcome[] }> {
  let scope: CuratorScope | undefined;
  if (eventId) {
    const [sections, unitIds] = await Promise.all([
      deps.db.call<SectionRef[]>("list_affected_sections", { p_event_id: eventId }),
      deps.db.call<string[]>("living_page_event_units", { p_event_id: eventId }),
    ]);
    scope = { pageIds: [...new Set(sections.map((section) => section.pageId))], unitIds };
  }
  const curator = options.curate === false ? null : await workflowStep("curator:structure", () => processingSpan("stage.curator.structure", () => runCuratorPass(deps.db, undefined, { scope })));
  if (curator) await writeMergedSections(deps.db, deps.writer, curator.mergedSectionIds);
  const overviews = await processingSpan("stage.curator.overviews", () => refreshOrganizationOverviews(deps, eventId,
    scope ? { affectedPageIds: [...scope.pageIds, ...(curator?.affectedPageIds ?? [])] } : {}));
  for (const outcome of overviews.filter((o) => o.status === "failed")) console.error(`Overview for “${outcome.title}” failed:`, outcome.detail);
  const dispatched = await processingSpan("stage.curator.dispatch", () => runDispatches(deps, curator?.dispatches ?? options.dispatches ?? []));
  for (const outcome of dispatched.filter((o) => o.status === "failed")) console.error(`Curator dispatch (${outcome.role}) failed:`, outcome.detail);
  // An upload must retain unfinished upkeep for recovery. Manual callers still
  // receive each outcome so they can show partial results.
  const failures = [...overviews, ...dispatched].filter((outcome) => outcome.status === "failed");
  if (eventId && failures.length) throw new Error(`Page maintenance unfinished: ${failures.map((outcome) => outcome.detail).join("; ")}`);
  return { curator, overviews, dispatched };
}
