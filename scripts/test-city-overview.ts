import { createServer } from "vite";
import { resolve, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import type { SectionState, SectionReviseInput, LineText } from "../lib/living-page/types";
import type { OverviewOutcome } from "../lib/living-page/refreshOrganizationOverviews";

// Live evidence is read-only. Planning and writing run in memory, with no
// database mutation or AI-log callback. Output is a local test artifact only.
const root = resolve(".");
const runtime = await createServer({ configFile: false, appType: "custom", server: { middlewareMode: true, watch: null, hmr: false }, resolve: { alias: { "@": root, "server-only": join(root, "test/server-only.ts") } } });
try {
  const { getAdminSupabase } = await runtime.ssrLoadModule("/lib/supabase/admin.ts");
  const { supabaseRpc } = await runtime.ssrLoadModule("/lib/db/rpc.ts");
  const live = getAdminSupabase();
  const liveDb = supabaseRpc(live);
  const allowed = new Set(["curator_snapshot", "list_page_sections", "read_section_state", "get_workspace_settings", "get_ai_role_instructions", "get_ai_stage_skills", "get_ai_skill_library", "get_role_memory"]);
  const db = { call: (name: string, args?: unknown) => {
    assert(allowed.has(name), `Test blocked RPC: ${name}`);
    return liveDb.call(name, args);
  } };
  const { data: page, error } = await live.from("pages").select("id,title,slug").eq("slug", "city-of-edmonton").is("retired_at", null).single();
  if (error) throw error;
  const snapshot = await db.call("curator_snapshot");
  const { organizationPageHealth, placeholderPageHealth } = await runtime.ssrLoadModule("/lib/living-page/organizationOverview.ts");
  const health = [...organizationPageHealth(snapshot.pages), ...placeholderPageHealth(snapshot.pages)].find((p) => p.pageId === page.id);
  assert(health, "The actual City page must qualify for overview repair");
  const refs = await db.call("list_page_sections", { p_page_id: page.id });
  const before: SectionState[] = [];
  for (const ref of refs) before.push(await db.call("read_section_state", { p_section_id: ref.sectionId }));
  const { overviewInput, refreshOrganizationOverviews } = await runtime.ssrLoadModule("/lib/living-page/refreshOrganizationOverviews.ts");
  const evidence = await overviewInput(live, snapshot, health);
  assert.equal(typeof evidence, "object");
  const { readModelChoice } = await runtime.ssrLoadModule("/lib/ai/models.ts");
  const { loadStageSkills } = await runtime.ssrLoadModule("/lib/ai/skills/server.ts");
  const { tokenFactoryFromEnv } = await runtime.ssrLoadModule("/lib/ai/chat.ts");
  const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db));
  assert(settings, "Real AI provider required");
  settings.skills = await loadStageSkills(db);
  const directory = resolve("artifacts/city-overview-test", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "original.json"), JSON.stringify({ page, before, evidence, health }, null, 2));
  console.log(JSON.stringify({ directory, title: page.title, originalSections: before.map((s) => s.title), ownClaims: evidence.own.length, borrowedClaims: evidence.borrowed.length, children: evidence.childPages }));
  const outcomes: OverviewOutcome[] = await refreshOrganizationOverviews({ db, client: live, settings }, null, { dryRun: true, pageIds: [page.id] });
  const plan = outcomes.find((p) => p.pageId === page.id);
  assert.equal(plan?.status, "planned", plan?.detail ?? undefined);
  const { TokenFactorySectionWriter } = await runtime.ssrLoadModule("/lib/living-page/writers/tokenFactory.ts");
  const { assertStyleCoverage } = await runtime.ssrLoadModule("/lib/living-page/refreshStyle.ts");
  const writer = new TokenFactorySectionWriter(settings);
  const units = new Map([...evidence.own, ...evidence.borrowed].map((unit) => [unit.unitId, unit]));
  const result: { title: string; lines: LineText[]; model: string }[] = [];
  assert(plan);
  for (const section of plan.sections) {
    assert(section.query.unitIds);
    const selected = section.query.unitIds.map((id: string) => units.get(id));
    assert(selected.every(Boolean));
    const input: SectionReviseInput = { pageTitle: page.title, sectionTitle: section.title, units: selected, lines: [], uncoveredUnitIds: section.query.unitIds, pageContext: result.map((s) => ({ section: s.title, text: s.lines.map((l) => l.text).join("\n") })) };
    const revision = await writer.reviseSection(input);
    assertStyleCoverage(input, revision);
    result.push({ title: section.title, lines: revision.add, model: revision.modelVersion });
  }
  await writeFile(join(directory, "result.json"), JSON.stringify({ plan, result }, null, 2));
  const text = result.map((s) => `${s.title}\n${s.lines.map((l) => l.text).join("\n\n")}`).join("\n\n");
  await writeFile(join(directory, "result.txt"), text);
  assert.match(result[0]?.lines[0]?.text ?? "", /^The City of Edmonton\b|^City of Edmonton\b/);
  assert(!result.some((s) => /when a ULA|circulation to pipeline|processing and approval/i.test(s.title)));
  const after = [];
  for (const ref of refs) after.push(await db.call("read_section_state", { p_section_id: ref.sectionId }));
  assert.deepEqual(after, before, "Live page must remain unchanged");
  console.log(JSON.stringify({ passed: true, directory, result: text }));
} finally { await runtime.close(); }
