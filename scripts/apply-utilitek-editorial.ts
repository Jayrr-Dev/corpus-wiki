import { createServer } from "vite";
import { resolve } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import type { SectionState, SectionRevision } from "../lib/living-page/types";
const tested = resolve("artifacts/utilitek-editorial-test/2026-10-17T16-20-39-643Z");
const original = JSON.parse(await readFile(resolve(tested, "original.json"), "utf8")) as { states: SectionState[] };
const result = JSON.parse(await readFile(resolve(tested, "result.json"), "utf8")) as { revisions: SectionRevision[] };
const runtime = await createServer({ configFile: false, appType: "custom", server: { middlewareMode: true, watch: null, hmr: false }, resolve: { alias: { "@": resolve("."), "server-only": resolve("test/server-only.ts") } } });
try {
  const { getAdminSupabase } = await runtime.ssrLoadModule("/lib/supabase/admin.ts");
  const { supabaseRpc } = await runtime.ssrLoadModule("/lib/db/rpc.ts");
  const db = supabaseRpc(getAdminSupabase());
  const { styleRefreshState, assertStyleCoverage } = await runtime.ssrLoadModule("/lib/living-page/refreshStyle.ts");
  const { revisionToActions, uncoveredUnitIds } = await runtime.ssrLoadModule("/lib/living-page/plan.ts");
  const { submitChangeSet, commitChangeSet } = await runtime.ssrLoadModule("/lib/change-control/index.ts");
  const actions = [];
  const before = [];
  for (const [index, title] of ["Overview", "Company profile"].entries()) {
    const source = original.states.find((state) => state.title === title)!;
    const live: SectionState = await db.call("read_section_state", { p_section_id: source.sectionId });
    assert.deepEqual(live.units, source.units, "Evidence changed since testing; do not apply stale output");
    assert.deepEqual(live.lines.map((line) => [line.lineId, line.content, line.author]), source.lines.map((line) => [line.lineId, line.content, line.author]), "Prose changed since testing; do not overwrite it");
    const state = styleRefreshState(live);
    const revision = result.revisions[index]!;
    assertStyleCoverage({ ...state, sectionTitle: title, uncoveredUnitIds: uncoveredUnitIds(state) }, revision);
    before.push(live);
    actions.push(...revisionToActions(revision, state).filter((action: { type: string; targetId: string; input: { content: string } }) => action.type !== "revise_line" || state.lines.find((line: { lineId: string; content: string }) => line.lineId === action.targetId)?.content !== action.input.content));
  }
  assert(actions.length);
  const directory = resolve("artifacts/utilitek-live-editorial", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "before.json"), JSON.stringify(before, null, 2));
  const { changeSetId } = await submitChangeSet(db, { eventId: null, cause: "edit", actor: "ai" }, { summary: "Applied tested Utilitek profile cleanup: removed repeated identity and source-document filler", actions, trace: { modelVersion: result.revisions[1]!.modelVersion, promptVersion: "tested-editorial-cleanup-v1", tokensIn: 0, tokensOut: 0 } });
  const committed = await commitChangeSet(db, changeSetId);
  assert.equal(committed.status, "applied");
  const after = [];
  for (const state of before) after.push(await db.call("read_section_state", { p_section_id: state.sectionId }));
  await writeFile(resolve(directory, "after.json"), JSON.stringify({ changeSetId, after }, null, 2));
  console.log(JSON.stringify({ directory, changeSetId, text: after.map((state) => ({ title: state.title, paragraphs: state.lines.map((line: { content: string }) => line.content) })) }, null, 2));
} finally { await runtime.close(); }
