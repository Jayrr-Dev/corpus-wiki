import "server-only";
import { refreshOrganizationOverviews, type OverviewOutcome } from "@/lib/living-page/refreshOrganizationOverviews";
import { runCuratorPass, type CuratorRunResult, writeMergedSections } from "./runCurator";
import { type DispatchDeps, type DispatchOutcome, runDispatches } from "./dispatch";
import type { Dispatch } from "./plan";

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
  const curator = options.curate === false ? null : await runCuratorPass(deps.db);
  if (curator) await writeMergedSections(deps.db, deps.writer, curator.mergedSectionIds);
  const overviews = await refreshOrganizationOverviews(deps, eventId);
  for (const outcome of overviews.filter((o) => o.status === "failed")) console.error(`Overview for “${outcome.title}” failed:`, outcome.detail);
  const dispatched = await runDispatches(deps, curator?.dispatches ?? options.dispatches ?? []);
  for (const outcome of dispatched.filter((o) => o.status === "failed")) console.error(`Curator dispatch (${outcome.role}) failed:`, outcome.detail);
  return { curator, overviews, dispatched };
}
