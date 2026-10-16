import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import { readModelChoice } from "@/lib/ai/models";
import { lostClaims, readVectors, type CuratorSnapshot } from "@/lib/curator/curate";
import { treeHealth } from "@/lib/curator/score";
import { supabaseRpc } from "@/lib/db/rpc";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { articleSections } from "./articlePlan";
import { loadArticleKnowledge, planArticle } from "./articlePlanner";
import { MAX_BORROWED_INTRO, descendantClaimIds, organizationPageHealth, plannedClaimIds } from "./organizationOverview";
import { overviewInput, refreshOrganizationOverviews } from "./refreshOrganizationOverviews";

// =====================================================================
// ORGANIZATION OVERVIEW BENCHMARK (explicit opt-in; real model calls on live
// data; saves nothing). For every organization page with child pages, plan
// it with the current Planner and with overview mode, and score both:
//   childClaims ≤ 3    — the page repeats at most an opening's worth of the pages under it
//   ownKept            — every claim only this page had is still on it
//   borrowed ≤ 3       — the opening borrows at most three child claims
//   lostClaims = 0     — no claim ends up on no page
//   organizationOverlaps = 0 across the tree
//   LIVE_OVERVIEW_BENCH=1 OVERVIEW_REPORT=<out.json>
// =====================================================================

it.skipIf(process.env.LIVE_OVERVIEW_BENCH !== "1")("benchmarks organization overviews on live pages", async () => {
  const client = getAdminSupabase();
  const db = supabaseRpc(client);
  const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db))!;
  const snapshot = await db.call<CuratorSnapshot>("curator_snapshot");
  const vectors = readVectors(snapshot);
  const targets = organizationPageHealth(snapshot.pages);
  const score = (pageId: string, planned: string[]) => {
    const page = snapshot.pages.find((p) => p.id === pageId)!;
    const below = descendantClaimIds(snapshot.pages, pageId);
    const ownBefore = page.claimIds.filter((id) => !below.has(id));
    const pagesAfter = snapshot.pages.map((p) => (p.id === pageId ? { ...p, claimIds: planned } : p));
    return {
      claims: planned.length,
      childClaims: planned.filter((id) => below.has(id)).length,
      ownKept: ownBefore.every((id) => planned.includes(id)),
      lostClaims: lostClaims(snapshot.pages, pagesAfter).length,
      organizationOverlaps: treeHealth(pagesAfter, vectors).organizationOverlaps,
    };
  };

  const reports = [];
  // Overview mode, through the same code the triggers run (dry run)
  const overviews = await refreshOrganizationOverviews({ settings, client, db }, null, { dryRun: true });
  for (const target of targets) {
    const input = await overviewInput(client, snapshot, target);
    // The current Planner: every claim about the organization, all of them in a section
    let current: ReturnType<typeof score> | { error: string };
    try {
      if (typeof input === "string") throw new Error(input);
      const knowledge = await loadArticleKnowledge(client, input.organization.id);
      const { plan } = await planArticle(settings, knowledge);
      current = { ...score(target.pageId, plannedClaimIds(articleSections(plan, knowledge))), renamedTo: plan.title } as ReturnType<typeof score>;
    } catch (error) { current = { error: error instanceof Error ? error.message : String(error) }; }
    const overview = overviews.find((o) => o.pageId === target.pageId);
    const planned = overview ? plannedClaimIds(overview.sections) : [];
    const borrowed = typeof input === "string" ? 0 : (overview?.sections[0]?.query.unitIds ?? []).filter((id) => input.borrowed.some((u) => u.unitId === id)).length;
    reports.push({
      page: target.title, before: { claims: target.claims, childClaims: target.childClaims }, needsOverview: target.needsOverview,
      currentPlanner: current,
      overviewMode: overview ? { status: overview.status, detail: overview.detail, sections: overview.sections.map((s) => `${s.title} (${s.query.unitIds?.length ?? 0})`), borrowed, ...score(target.pageId, planned) } : "not needed",
    });
  }
  // The whole tree with every planned overview in place
  const treeAfter = snapshot.pages.map((p) => { const o = overviews.find((x) => x.pageId === p.id && x.status === "planned"); return o ? { ...p, claimIds: plannedClaimIds(o.sections) } : p; });
  const tree = { before: treeHealth(snapshot.pages, vectors), after: treeHealth(treeAfter, vectors), lostClaims: lostClaims(snapshot.pages, treeAfter).length,
    stillNeedOverview: organizationPageHealth(treeAfter).filter((h) => h.needsOverview).map((h) => h.title) };
  if (process.env.OVERVIEW_REPORT) writeFileSync(process.env.OVERVIEW_REPORT, JSON.stringify({ model: settings.model, tree, reports }, null, 1));
  expect(tree.lostClaims).toBe(0);
  expect(tree.after.organizationOverlaps).toBe(0);
  // Stable: a second refresh would find nothing to do
  expect(tree.stillNeedOverview).toEqual([]);
  for (const report of reports) {
    if (typeof report.overviewMode === "string") continue;
    expect(report.overviewMode.lostClaims).toBe(0);
    expect(report.overviewMode.ownKept).toBe(true);
    expect(report.overviewMode.childClaims).toBeLessThanOrEqual(MAX_BORROWED_INTRO);
    expect(report.overviewMode.borrowed).toBeLessThanOrEqual(MAX_BORROWED_INTRO);
  }
}, 1_800_000);
