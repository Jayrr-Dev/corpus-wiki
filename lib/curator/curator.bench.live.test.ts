import { readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { tokenFactoryFromEnv } from "@/lib/ai/chat";
import { curate, lostClaims, readVectors, type CuratorPass, type CuratorSnapshot } from "./curate";
import { scorePairs, type CuratorPage } from "./score";

// =====================================================================
// CURATOR BENCHMARK (explicit opt-in, real model calls, saves nothing).
// Runs the Curator on a snapshot of the wiki's pages and scores it against
// the success criteria: tree health before/after, no claim lost, no merge
// across organizations, how much waits on a person, and whether a second
// pass on the cleaned tree finds little left to do.
//   LIVE_CURATOR_BENCH=1 CURATOR_FIXTURE=<snapshot.json> CURATOR_MODELS=anthropic/claude-opus-5-5,... CURATOR_REPORT=<out.json>
// =====================================================================

type Fixture = { charter: unknown; snapshot: CuratorSnapshot };

const STRUCTURAL = new Set(["merge", "move"]);

// What change control holds for a person (mirrors change_control.judge for update_page)
function held(pass: CuratorPass): number {
  return pass.changes.filter((change) => !change.confident || change.operation === "move" || change.operation === "group" || (change.operation === "merge" && change.unitIds.length > 0)).length;
}

// Merges whose two pages sit under different organizations in the original tree
function crossOrganizationMerges(pages: readonly CuratorPage[], pass: CuratorPass): string[] {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const orgOf = (id: string): string | null => {
    const seen = new Set<string>();
    let at = byId.get(id);
    while (at && !seen.has(at.id)) {
      seen.add(at.id);
      if (at.contextName) return at.contextName;
      at = at.parentId ? byId.get(at.parentId) : undefined;
    }
    return null;
  };
  return pass.changes.flatMap((change) => {
    if (change.operation !== "merge") return [];
    const a = orgOf(change.pageId), b = orgOf(change.intoPageId);
    return a && b && a !== b ? [`${byId.get(change.pageId)!.title} → ${byId.get(change.intoPageId)!.title}`] : [];
  });
}

it.skipIf(process.env.LIVE_CURATOR_BENCH !== "1")("benchmarks the Curator on a page snapshot", async () => {
  const fixture = JSON.parse(readFileSync(process.env.CURATOR_FIXTURE!, "utf8")) as Fixture;
  const models = (process.env.CURATOR_MODELS ?? "anthropic/claude-opus-5-5").split(",").map((m) => m.trim()).filter(Boolean);
  const titles = new Map(fixture.snapshot.pages.map((page) => [page.id, page.title]));
  const title = (id: string | null) => (id ? titles.get(id) ?? id : "top level");
  const reports = [];

  for (const model of models) {
    const settings = tokenFactoryFromEnv(process.env, { model, roleModels: { curator: model }, effort: "high", roleEfforts: { curator: "high" } })!;
    const started = Date.now();
    const first = await curate(settings, fixture.snapshot, { charter: fixture.charter });
    const firstMs = Date.now() - started;
    // Second pass on the cleaned tree: a stable Curator finds little structural work left
    const second = await curate(settings, { ...fixture.snapshot, pages: first.pagesAfter }, { charter: fixture.charter });
    const vectors = readVectors(fixture.snapshot);
    const remainingDuplicates = scorePairs(first.pagesAfter, vectors).filter((pair) => Math.max(pair.aInB, pair.bInA) >= 0.9)
      .map((pair) => `${title(pair.a)} ⊂≈ ${title(pair.b)} (${pair.aInB.toFixed(2)}/${pair.bInA.toFixed(2)})`);
    const report = {
      model,
      seconds: Math.round(firstMs / 1000),
      tokens: { in: first.tokensIn, out: first.tokensOut },
      before: first.before,
      after: first.after,
      safety: {
        lostClaims: lostClaims(fixture.snapshot.pages, first.pagesAfter).length,
        crossOrganizationMerges: crossOrganizationMerges(fixture.snapshot.pages, first),
        skipped: first.skipped.map((skip) => `${skip.proposal.operation} ${skip.proposal.page}: ${skip.why}`),
      },
      trust: { proposed: first.changes.length, heldForYou: held(first), appliedAtOnce: first.changes.length - held(first) },
      stability: { secondPassStructural: second.changes.filter((c) => STRUCTURAL.has(c.operation)).length, secondPassTotal: second.changes.length,
        secondPassChanges: second.changes.map((c) => `${c.operation}: ${c.reason}`) },
      remainingDuplicates,
      changes: first.changes.map((change) => ({
        operation: change.operation, page: title(change.pageId), confident: change.confident, reason: change.reason,
        ...(change.operation === "merge" ? { into: title(change.intoPageId), newSection: change.unitIds.length ? change.sectionTitle : null, claimsMoved: change.unitIds.length } : {}),
        ...(change.operation === "move" ? { parent: title(change.parentPageId) } : {}),
        ...(change.operation === "rename" ? { title: change.title } : {}),
        ...(change.operation === "set_type" ? { articleType: change.articleType, scope: change.scope } : {}),
        ...(change.operation === "group" ? { newPage: change.title, articleType: change.articleType, parent: title(change.parentPageId), files: change.pageIds.map(title) } : {}),
      })),
      dispatches: first.dispatches.map((d) => ({ role: d.role, page: title(d.pageId), heading: d.heading, note: d.note, reason: d.reason })),
      dispatchSkipped: first.dispatchSkipped,
      treeAfter: first.pagesAfter.map((page) => ({ title: page.title, parent: first.pagesAfter.find((p) => p.id === page.parentId)?.title ?? null, type: page.articleType, claims: page.claimIds.length })),
      summary: first.answer?.summary ?? null,
    };
    reports.push(report);
    expect(report.safety.lostClaims).toBe(0);
  }
  if (process.env.CURATOR_REPORT) writeFileSync(process.env.CURATOR_REPORT, JSON.stringify(reports, null, 1));
}, 1_800_000);
