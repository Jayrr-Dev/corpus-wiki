import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { SectionState, SectionQuery } from "../lib/living-page/types";
import type { DraftAction } from "../lib/ai/types";

// Explicit maintenance: audited section replacements; page identity and claims stay intact.
const root = fileURLToPath(new URL("..", import.meta.url));
const runtime = await createServer({ configFile: false, appType: "custom", server: { middlewareMode: true, watch: null }, resolve: { alias: { "@": root, "server-only": join(root, "test/server-only.ts") } } });
try {
  const { getServerDeps } = await runtime.ssrLoadModule("/lib/server/deps.ts");
  const { getAdminSupabase } = await runtime.ssrLoadModule("/lib/supabase/admin.ts");
  const { tokenFactoryFromEnv } = await runtime.ssrLoadModule("/lib/ai/chat.ts");
  const { readChosenModel } = await runtime.ssrLoadModule("/lib/ai/models.ts");
  const { loadStageSkills } = await runtime.ssrLoadModule("/lib/ai/skills/server.ts");
  const { planArticle, topicSections } = await runtime.ssrLoadModule("/lib/living-page/articlePlanner.ts");
  const { submitChangeSet, commitChangeSet, revertChangeSet } = await runtime.ssrLoadModule("/lib/change-control/index.ts");
  const { rebuildSection } = await runtime.ssrLoadModule("/lib/living-page/index.ts");
  const client = getAdminSupabase();
  const { data: pages, error } = await client.from("pages").select("id,title,slug,parent_page_id").is("retired_at", null);
  if (error) throw new Error(error.message);
  const { data: sections, error: sectionError } = await client.from("sections").select("id,page_id,title,mode,query,position").is("retired_at", null).order("position");
  if (sectionError) throw new Error(sectionError.message);
  const targets = pages.filter((page: { id: string }) => sections.some((section: { page_id: string; title: string; mode: string }) => section.page_id === page.id && section.mode === "generated" && section.title === "Context and requirements"));
  console.log(JSON.stringify({ targets: targets.map((page: { title: string }) => page.title) }));
  if (process.argv.includes("--apply")) {
    const { db, writer } = await getServerDeps();
    const settings = tokenFactoryFromEnv(process.env, await readChosenModel(db), (call: unknown) => db.call("log_ai_call", { p_call: call }));
    if (!settings || writer.name === "fake") throw new Error("Configure an AI provider first.");
    settings.skills = await loadStageSkills(db);
    const report = { completed: [] as unknown[], skipped: [] as string[], failed: [] as unknown[] };
    const reportPath = join(tmpdir(), `subarticle-replan-${Date.now()}.json`);
    console.log(`Report: ${reportPath}`);
    for (const page of targets) {
      let changeSetId: string | undefined;
      try {
        const old = sections.filter((section: { page_id: string; mode: string }) => section.page_id === page.id && section.mode === "generated");
        const states: SectionState[] = [];
        for (const section of old) states.push(await db.call("read_section_state", { p_section_id: section.id }));
        if (states.some((state) => state.lines.some((line) => line.author === "person"))) {
          report.skipped.push(`${page.title}: handwritten content`);
          continue;
        }
        const units = [...new Map(states.flatMap((state) => state.units).map((unit) => [unit.unitId, unit])).values()];
        if (!units.length) { report.skipped.push(`${page.title}: no claims`); continue; }
        const scope = old.find((section: { query: SectionQuery }) => section.query?.entity)?.query as SectionQuery | undefined;
        if (!scope?.entity) throw new Error("No entity scope for this article.");
        const knowledge = { entity: { id: "", ...scope.entity, name: page.title }, units };
        const { plan, tokensIn, tokensOut } = await planArticle(settings, knowledge, page.title);
        // Keep scope, aliases and domain filters while replacing only claim selections.
        const planned = topicSections(plan, knowledge).map((section: { title: string; query: SectionQuery }) => {
          const query = { ...scope, ...section.query };
          delete query.kinds;
          return { title: section.title, query };
        });
        const base = { expectedRevisionId: null, passageIds: [], speechAct: null };
        // Build replacements before retiring the old sections. A failed build can be undone.
        const actions: DraftAction[] = planned.map((section: object) => ({ ...base, type: "create_section", targetId: null, input: { pageId: page.id, ...section } }));
        const submitted = await submitChangeSet(db, { eventId: null, cause: "edit", actor: "ai" }, { summary: `Replanned sections for ${page.title}`, actions, trace: { modelVersion: settings.model ?? null, promptVersion: "subarticle-replan-v1", tokensIn, tokensOut } });
        changeSetId = submitted.changeSetId;
        const committed = await commitChangeSet(db, changeSetId);
        if (committed.status !== "applied") throw new Error(`Section creation: ${committed.status}`);
        const { data: created, error: createdError } = await client.from("actions").select("target_id").eq("change_set_id", changeSetId).eq("type", "create_section").eq("outcome", "applied");
        if (createdError) throw new Error(createdError.message);
        if (created.length !== planned.length) throw new Error("Replacement section count mismatch.");
        for (const section of created) {
          if (!await rebuildSection(db, writer, section.target_id, null)) throw new Error("Section build busy.");
          const built: SectionState = await db.call("read_section_state", { p_section_id: section.target_id });
          const covered = new Set(built.lines.flatMap((line) => line.unitIds));
          if (built.units.some((unit) => !covered.has(unit.unitId))) throw new Error("Replacement prose omitted claims.");
        }
        const retirement = await submitChangeSet(db, { eventId: null, cause: "edit", actor: "ai" }, { summary: `Replaced repetitive sections in ${page.title}`, actions: old.map((section: { id: string }) => ({ ...base, type: "retire_section", targetId: section.id, input: {} })), trace: { modelVersion: null, promptVersion: "subarticle-replan-v1", tokensIn: null, tokensOut: null } });
        if ((await commitChangeSet(db, retirement.changeSetId)).status !== "applied") throw new Error("Old sections could not be retired.");
        report.completed.push({ page: page.title, headings: planned.map((section: { title: string }) => section.title), changeSetId, retirementId: retirement.changeSetId });
        console.log(JSON.stringify(report.completed.at(-1)));
      } catch (error) {
        if (changeSetId) {
          try { await revertChangeSet(db, changeSetId); } catch (undoError) { console.error(`Undo failed: ${String(undoError)}`); }
        }
        report.failed.push({ page: page.title, error: String(error) });
        console.error(JSON.stringify(report.failed.at(-1)));
      }
      await writeFile(reportPath, JSON.stringify(report, null, 2));
    }
    console.log(JSON.stringify(report));
    if (report.failed.length) process.exitCode = 1;
  }
} finally { await runtime.close(); }
