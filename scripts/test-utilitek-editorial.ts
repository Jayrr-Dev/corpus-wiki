import { createServer } from "vite";
import { resolve, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import type { SectionState, SectionReviseInput, SectionRevision } from "../lib/living-page/types";

// Runs real AI against original page text in memory. All live RPCs are read-only.
const source = process.argv[2];
assert(source, "Pass the original page snapshot JSON");
const original = JSON.parse(await readFile(resolve(source), "utf8")) as { page: { id: string; title: string }; states: SectionState[] };
const runtime = await createServer({ configFile: false, appType: "custom", server: { middlewareMode: true, watch: null, hmr: false }, resolve: { alias: { "@": resolve("."), "server-only": resolve("test/server-only.ts") } } });
try {
  const { getAdminSupabase } = await runtime.ssrLoadModule("/lib/supabase/admin.ts");
  const { supabaseRpc } = await runtime.ssrLoadModule("/lib/db/rpc.ts");
  const live = supabaseRpc(getAdminSupabase());
  const allowed = new Set(["get_workspace_settings", "get_ai_role_instructions", "get_ai_skill_library", "get_role_memory", "read_section_state"]);
  const db = { call: (name: string, args?: unknown) => { assert(allowed.has(name), `Blocked mutation: ${name}`); return live.call(name, args); } };
  const { readModelChoice } = await runtime.ssrLoadModule("/lib/ai/models.ts");
  const { tokenFactoryFromEnv } = await runtime.ssrLoadModule("/lib/ai/chat.ts");
  const { loadStageSkills } = await runtime.ssrLoadModule("/lib/ai/skills/server.ts");
  const { TokenFactorySectionWriter } = await runtime.ssrLoadModule("/lib/living-page/writers/tokenFactory.ts");
  const { styleRefreshState, assertStyleCoverage } = await runtime.ssrLoadModule("/lib/living-page/refreshStyle.ts");
  const { revisionToActions, uncoveredUnitIds } = await runtime.ssrLoadModule("/lib/living-page/plan.ts");
  const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db));
  assert(settings);
  settings.skills = await loadStageSkills(db);
  const writer = new TokenFactorySectionWriter(settings);
  const states = structuredClone(original.states);
  const directory = resolve("artifacts/utilitek-editorial-test", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "original.json"), JSON.stringify(original, null, 2));
  const liveBefore = [];
  for (const state of states) liveBefore.push(await db.call("read_section_state", { p_section_id: state.sectionId }));
  const revisions: SectionRevision[] = [];
  for (const title of ["Overview", "Company profile"]) {
    const state = states.find((s) => s.title === title);
    assert(state, `Original ${title} is required`);
    const refreshed = styleRefreshState(state);
    const input: SectionReviseInput = { ...refreshed, sectionTitle: title, uncoveredUnitIds: uncoveredUnitIds(refreshed), pageContext: states.filter((s) => s !== state).map((s) => ({ section: s.title, text: s.lines.map((line) => line.content).join("\n\n") })) };
    console.log(`Testing original ${title} (${state.units.length} claims)…`);
    const revision: SectionRevision = await writer.reviseSection(input);
    await writeFile(join(directory, `${title.replaceAll(" ", "-")}.json`), JSON.stringify({ input, revision }, null, 2));
    assertStyleCoverage(input, revision);
    revisions.push(revision);
    // Apply the same protected-line/citation action planner as production,
    // but only to this in-memory clone.
    const actions = revisionToActions(revision, refreshed);
    for (const action of actions) {
      if (action.type === "retire_line") state.lines = state.lines.filter((line) => line.lineId !== action.targetId);
      if (action.type === "revise_line" || action.type === "write_line") {
        const unitIds = state.units.filter((unit) => action.input.unitRevisionIds.includes(unit.revisionId)).map((unit) => unit.unitId);
        if (action.type === "revise_line") Object.assign(state.lines.find((line) => line.lineId === action.targetId)!, { content: action.input.content, unitIds });
        else state.lines.push({ lineId: crypto.randomUUID(), lineRevisionId: "test", author: "ai", position: state.lines.length, needsRewrite: false, content: action.input.content, unitIds });
      }
    }
  }
  const textOf = (title: string) => states.find((s) => s.title === title)!.lines.map((line) => line.content).join("\n\n");
  const intro = textOf("Overview");
  const profile = textOf("Company profile");
  await writeFile(join(directory, "result.json"), JSON.stringify({ states, revisions }, null, 2));
  await writeFile(join(directory, "result.txt"), `Introduction\n${intro}\n\nCompany profile\n${profile}\n`);
  assert.match(intro, /engineering services company.*Edmonton/i);
  assert.match(profile, /privately held/i);
  assert.match(profile, /(?:twenty-five|25) years/i);
  assert.match(profile, /(?:reports|advertises|claims|states|says|according to)/i);
  assert.doesNotMatch(profile, /headquarter|engineering (?:services company|consultancy)/i);
  assert.doesNotMatch(`${intro}\n${profile}`, /information in this section|internal operating policy|test document|website snapshot|claim the company makes in its own marketing/i);
  const introSentences = intro.split(/(?<=[.!?])\s+/).filter((s) => s.length > 30);
  for (const sentence of introSentences) assert(!profile.includes(sentence), "Profile repeats an introduction sentence");
  const liveAfter = [];
  for (const state of states) liveAfter.push(await db.call("read_section_state", { p_section_id: state.sectionId }));
  assert.deepEqual(liveAfter, liveBefore, "Live page changed during the isolated test");
  console.log(JSON.stringify({ passed: true, directory, intro, profile }, null, 2));
} finally { await runtime.close(); }
