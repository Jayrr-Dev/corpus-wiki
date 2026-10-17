import { createServer } from "vite";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { SectionState } from "../lib/living-page/types";
import type { SectionWriter } from "../lib/living-page";
import type { ArticlePlan } from "../lib/living-page/articlePlan";
import type { Attempt } from "../lib/living-page/outlineBuilder";
import type { DraftAction } from "../lib/ai/types";
import type { AdminSupabase } from "../lib/supabase/admin";
import type { DbRpc } from "../lib/db/rpc";
import type { RoleInstruction } from "../lib/ai/skills/types";
type WorkspaceSettings = { aiModel: string | null; aiRoleModels?: Record<string, string> };

const slug = process.argv.find((arg) => arg.startsWith("--slug="))?.slice(7);
if (!slug) throw new Error("Specify --slug=the-exact-page-slug");
const root = fileURLToPath(new URL("..", import.meta.url));
const runtime = await createServer({ configFile: false, appType: "custom", server: { middlewareMode: true, watch: null, hmr: false }, resolve: { alias: { "@": root, "server-only": join(root, "test/server-only.ts") } } });
try {
  const { getAdminSupabase } = await runtime.ssrLoadModule("/lib/supabase/admin.ts");
  const { supabaseRpc } = await runtime.ssrLoadModule("/lib/db/rpc.ts");
  const client = getAdminSupabase() as AdminSupabase;
  const db = supabaseRpc(client) as DbRpc;
  const { data: page, error } = await client.from("pages").select("id,title,slug,entity_id,article_type").eq("slug", slug).is("retired_at", null).single();
  if (error) throw new Error(error.message);
  const { data: sections, error: sectionError } = await client.from("sections").select("id,title,mode,query,position").eq("page_id", page.id).is("retired_at", null).order("position");
  if (sectionError) throw new Error(sectionError.message);
  const states: SectionState[] = [];
  if (!sections) throw new Error("Sections were not returned.");
  for (const section of sections) states.push(await db.call("read_section_state", { p_section_id: section.id }));
  const workspace = await db.call<WorkspaceSettings>("get_workspace_settings");
  const roles = await db.call<RoleInstruction[]>("get_ai_role_instructions");
  const directory = resolve("artifacts/sections-live", `${new Date().toISOString().replace(/[:.]/g, "-")}-${slug}`);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "before.json"), JSON.stringify({ page, sections, states, workspace, roles }, null, 2));
  console.log(JSON.stringify({ directory, page, sections: states.map((state) => ({ id: state.sectionId, title: state.title, claims: state.units.length, lines: state.lines.length, handwritten: state.lines.filter((line) => line.author === "person").length })), models: { default: workspace.aiModel, roles: workspace.aiRoleModels }, planner: roles.find((role: { role: string }) => role.role === "plan_articles") }, null, 2));
  const fingerprint = (current: SectionState[]) => createHash("sha256").update(JSON.stringify(current.map((state) => ({ id: state.sectionId, title: state.title, units: state.units.map((u) => [u.unitId, u.revisionId]).sort(), lines: state.lines.map((l) => [l.lineId, l.lineRevisionId, l.content]).sort() })).sort((a, b) => a.id.localeCompare(b.id)))).digest("hex");
  const applyPath = process.argv.find((arg) => arg.startsWith("--apply-plan="))?.slice(13);
  const planning = process.argv.includes("--plan");
  if (process.argv.includes("--update-role")) {
    const { articleStyle } = await runtime.ssrLoadModule("/lib/living-page/articleStyle.ts");
    const previous = roles.find((role) => role.role === "plan_articles");
    await db.call("save_ai_role_instructions", { p_role: "plan_articles", p_instructions: articleStyle("outline"), p_expected_version: previous?.version ?? null });
    const updated = await db.call<RoleInstruction[]>("get_ai_role_instructions");
    await writeFile(join(directory, "role-update.json"), JSON.stringify({ previous: previous ?? null, current: updated.find((role) => role.role === "plan_articles") }, null, 2));
    console.log("Saved updated Planner role instructions.");
  }
  // The default inspect path never changes settings, claims, pages or sections.
  if (!planning && !applyPath) {
    console.log("Inspection complete; no changes applied.");
  } else {
    if (sections.some((s) => s.mode !== "generated") || states.some((s) => s.lines.some((l) => l.author === "person"))) throw new Error("This run preserves handwritten sections; target generated-only sections explicitly before proceeding.");
    const units = [...new Map(states.flatMap((state) => state.units).map((unit) => [unit.unitId, unit])).values()];
    const knowledge = { entity: { id: page.entity_id ?? page.id, type: "topic", key: page.slug, name: page.title }, units };
    const { tokenFactoryFromEnv } = await runtime.ssrLoadModule("/lib/ai/chat.ts");
    const { readModelChoice } = await runtime.ssrLoadModule("/lib/ai/models.ts");
    const { loadStageSkills } = await runtime.ssrLoadModule("/lib/ai/skills/server.ts");
    const { planArticle } = await runtime.ssrLoadModule("/lib/living-page/articlePlanner.ts");
    const { draftSchema, structuralProblems, OUTLINE_POLICY_VERSION } = await runtime.ssrLoadModule("/lib/living-page/outlineBuilder.ts");
    const modelOverride = process.argv.find((arg) => arg.startsWith("--model="))?.slice(8);
    const choice = await readModelChoice(db);
    const runChoice = modelOverride ? { ...choice, model: modelOverride, roleModels: { ...choice.roleModels, plan_articles: modelOverride, reviewer: modelOverride, write_articles: modelOverride } } : choice;
    if (process.argv.includes("--low-effort")) runChoice.roleEfforts = { ...runChoice.roleEfforts, plan_articles: "low", reviewer: "low", write_articles: "low" };
    const settings = tokenFactoryFromEnv(process.env, runChoice, (call: unknown) => db.call("log_ai_call", { p_call: call }));
    if (!settings) throw new Error("Configure an AI provider first.");
    settings.skills = await loadStageSkills(db);
    if (process.argv.includes("--low-effort")) settings.roleEfforts = { ...settings.roleEfforts, plan_articles: "low", reviewer: "low" };
    let planned: { pageId: string; fingerprint: string; plan: ArticlePlan; attempts: Attempt[]; tokensIn: number | null; tokensOut: number | null };
    if (applyPath) {
      planned = JSON.parse(await readFile(resolve(applyPath), "utf8"));
      if (planned.pageId !== page.id || planned.fingerprint !== fingerprint(states)) throw new Error("The live page changed after planning. Replan before applying.");
      planned.plan = draftSchema.shape.plan.parse(planned.plan);
    } else {
      const notePath = process.argv.find((arg) => arg.startsWith("--note-file="))?.slice(12);
      const note = notePath ? await readFile(resolve(notePath), "utf8") : "Improve the section structure and reading order of this process article from its existing knowledge units. Keep all evidence, responsibilities, exceptions and procedure dependencies. Consolidate repeated purpose, approval, and flowchart topics where appropriate. Distinguish the operational process from documentation about its flowchart. Choose as many sections as the evidence needs; do not force a numeric target. Keep the article's current scope and title.";
      const attempts: Attempt[] = [];
      try {
        const result = await planArticle(settings, knowledge, page.title, note, { onAttempt: (attempt: Attempt) => {
          attempts.push(attempt);
          console.log(JSON.stringify({ attempt: attempts.length, accepted: attempt.accepted, headings: attempt.plan.sections.map((s) => s.title), problems: attempt.problems, review: attempt.review }));
        } });
        planned = { pageId: page.id, fingerprint: fingerprint(states), ...result, attempts };
      } finally { await writeFile(join(directory, "attempts.json"), JSON.stringify(attempts, null, 2)); }
      await writeFile(join(directory, "plan.json"), JSON.stringify(planned, null, 2));
      console.log(`Reviewed plan: ${join(directory, "plan.json")}`);
    }
    const problems: string[] = structuralProblems(planned.plan, knowledge);
    if (problems.length) throw new Error(problems.join(" "));
    if (applyPath) {
      if (!planned.attempts.at(-1)?.accepted || JSON.stringify(planned.attempts.at(-1)?.plan) !== JSON.stringify(planned.plan)) throw new Error("Only an unchanged, reviewed plan can be applied.");
      const { submitChangeSet, commitChangeSet, revertChangeSet } = await runtime.ssrLoadModule("/lib/change-control/index.ts");
      const { articleSections } = await runtime.ssrLoadModule("/lib/living-page/articlePlan.ts");
      const { revisionToActions } = await runtime.ssrLoadModule("/lib/living-page/plan.ts");
      const { getServerDeps } = await runtime.ssrLoadModule("/lib/server/deps.ts");
      const { rebuildSection, getSectionWriter } = await runtime.ssrLoadModule("/lib/living-page/index.ts");
      const deps = await getServerDeps();
      const writer = modelOverride ? getSectionWriter(process.env, runChoice, settings.skills, (call: unknown) => db.call("log_ai_call", { p_call: call })) as SectionWriter : deps.writer as SectionWriter;
      if (modelOverride) { writer.progress = deps.writer.progress; writer.reviewSections = deps.writer.reviewSections; }
      if (writer.name === "fake") throw new Error("A real section writer is required.");
      const base = { expectedRevisionId: null, passageIds: [], speechAct: null };
      const proposed: { title: string; query: { unitIds: string[] } }[] = articleSections(planned.plan, knowledge);
      const actions: DraftAction[] = proposed.map((section) => ({ ...base, type: "create_section", targetId: null, input: { pageId: page.id, title: section.title, query: { unitIds: section.query.unitIds, article: true } } }));
      const reusePath = process.argv.find((arg) => arg.startsWith("--reuse-built="))?.slice(14);
      const reusable = new Map<string, SectionState>();
      if (reusePath) {
        const prior = JSON.parse(await readFile(resolve(reusePath), "utf8")) as { createdIds: string[] };
        const { data: owned, error: ownedError } = await client.from("sections").select("id").in("id", prior.createdIds).eq("page_id", page.id);
        if (ownedError || owned.length !== prior.createdIds.length) throw new Error("Reusable sections must belong to this exact page.");
        for (const id of prior.createdIds) {
          const source = await db.call<SectionState>("read_section_state", { p_section_id: id });
          const covered = new Set(source.lines.flatMap((line) => line.unitIds));
          if (source.lines.length && source.lines.every((line) => line.author === "ai") && source.units.every((unit) => covered.has(unit.unitId))) reusable.set(source.title, source);
        }
      }
      let creationId: string | undefined;
      let retirementId: string | undefined;
      let retired = false;
      try {
        const submitted = await submitChangeSet(db, { eventId: null, cause: "edit", actor: "ai" }, { summary: `Built reviewed replacement sections for ${page.title}`, actions, trace: { modelVersion: settings.model, promptVersion: OUTLINE_POLICY_VERSION, tokensIn: planned.tokensIn, tokensOut: planned.tokensOut } });
        creationId = submitted.changeSetId;
        const committed = await commitChangeSet(db, submitted.changeSetId);
        if (committed.status !== "applied" || committed.rejected || committed.exceptions) throw new Error("Replacement section creation was not fully applied.");
        const { data: created, error: createdError } = await client.from("actions").select("target_id").eq("change_set_id", submitted.changeSetId).eq("type", "create_section").eq("outcome", "applied");
        if (createdError) throw new Error(createdError.message);
        if (created.length !== proposed.length || created.some((a) => !a.target_id)) throw new Error("Replacement section count mismatch.");
        const createdIds = created.map((action) => action.target_id!);
        const { data: ordered, error: orderedError } = await client.from("sections").select("id,title").in("id", createdIds).order("position");
        if (orderedError) throw new Error(orderedError.message);
        await writeFile(join(directory, "application.json"), JSON.stringify({ creationId, oldIds: sections.map((s) => s.id), createdIds }, null, 2));
        const stagedContext: { section: string; text: string }[] = [];
        const stagedWriter = Object.create(writer) as SectionWriter;
        // Old live prose stays visible until replacements are ready, but must not make
        // the writer omit replacement claims as "already covered elsewhere".
        stagedWriter.reviseSection = (input, progress) => writer.reviseSection({ ...input, pageContext: [...stagedContext] }, progress);
        for (const section of ordered) {
          console.log(`Writing replacement: ${section.title}`);
          const donor = reusable.get(section.title);
          if (donor) {
            const target = await db.call<SectionState>("read_section_state", { p_section_id: section.id });
            const revisions = (state: SectionState) => JSON.stringify(state.units.map((unit) => [unit.unitId, unit.revisionId]).sort());
            if (revisions(donor) === revisions(target) && !target.lines.length) {
              const reused: DraftAction[] = revisionToActions({ revise: [], retire: [], add: donor.lines.map((line) => ({ text: line.content, unitIds: line.unitIds })), modelVersion: "verified-prose-reuse", tokensIn: 0, tokensOut: 0 }, target);
              if (reused.length === donor.lines.length) {
                const copy = await submitChangeSet(db, { eventId: null, cause: "edit", actor: "ai" }, { summary: `Restored verified replacement prose for ${section.title}`, actions: reused, trace: { modelVersion: null, promptVersion: "verified-section-prose-reuse-v1", tokensIn: 0, tokensOut: 0 } });
                if ((await commitChangeSet(db, copy.changeSetId)).status !== "applied") throw new Error("Verified prose reuse did not fully apply.");
              }
            }
          }
          if (!await rebuildSection(db, stagedWriter, section.id, null, false)) throw new Error("A replacement build is busy.");
          const current = await db.call<SectionState>("read_section_state", { p_section_id: section.id });
          stagedContext.push({ section: current.title, text: current.lines.map((line) => line.content).join("\n") });
        }
        const built: SectionState[] = [];
        for (const section of ordered) built.push(await db.call("read_section_state", { p_section_id: section.id }));
        for (const state of built) {
          const covered = new Set(state.lines.flatMap((line) => line.unitIds));
          if (!state.lines.length || state.units.some((unit) => !covered.has(unit.unitId))) throw new Error(`Replacement ${state.title} omitted evidence.`);
        }
        const unchanged: SectionState[] = [];
        for (const section of sections) unchanged.push(await db.call("read_section_state", { p_section_id: section.id }));
        if (fingerprint(unchanged) !== planned.fingerprint) throw new Error("The original page changed while replacements were building; originals will be preserved.");
        const retirement = await submitChangeSet(db, { eventId: null, cause: "edit", actor: "ai" }, { summary: `Replaced overlapping sections in ${page.title}`, actions: sections.map((section): DraftAction => ({ ...base, type: "retire_section", targetId: section.id, input: {} })), trace: { modelVersion: settings.model, promptVersion: OUTLINE_POLICY_VERSION, tokensIn: 0, tokensOut: 0 } });
        retirementId = retirement.changeSetId;
        const result = await commitChangeSet(db, retirement.changeSetId);
        if (result.status !== "applied") {
          await revertChangeSet(db, retirement.changeSetId);
          throw new Error("The old sections were not fully replaced; retirement was reverted.");
        }
        retired = true;
        await writer.reviewSections?.(createdIds);
        const reviewed: SectionState[] = [];
        for (const section of ordered) reviewed.push(await db.call("read_section_state", { p_section_id: section.id }));
        for (const state of reviewed) {
          const covered = new Set(state.lines.flatMap((line) => line.unitIds));
          if (state.units.some((unit) => !covered.has(unit.unitId))) throw new Error(`Editorial review left ${state.title} without full evidence coverage.`);
        }
        await writeFile(join(directory, "after.json"), JSON.stringify({ page, creationId, retirementId: retirement.changeSetId, plan: planned.plan, states: reviewed }, null, 2));
        console.log(JSON.stringify({ applied: true, pageId: page.id, creationId, retirementId: retirement.changeSetId, headings: built.map((state) => state.title), claims: units.length, directory }, null, 2));
      } catch (error) {
        if (retired && retirementId) await revertChangeSet(db, retirementId);
        if (creationId) await revertChangeSet(db, creationId);
        throw error;
      }
    }
  }
} finally { await runtime.close(); }
