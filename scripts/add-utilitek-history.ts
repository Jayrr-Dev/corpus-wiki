import { createServer } from "vite";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const runtime = await createServer({ configFile: false, appType: "custom", server: { middlewareMode: true, watch: null, hmr: false }, resolve: { alias: { "@": resolve("."), "server-only": resolve("test/server-only.ts") } } });
try {
  const { getAdminSupabase } = await runtime.ssrLoadModule("/lib/supabase/admin.ts");
  const { getServerDeps } = await runtime.ssrLoadModule("/lib/server/deps.ts");
  const client = getAdminSupabase();
  const { db, writer } = await getServerDeps();
  const { data: page, error } = await client.from("pages").select("id,title,entity_id,context_entity_id").eq("slug", "utilitek-solutions-inc-2").is("retired_at", null).single();
  if (error) throw error;
  const { data: existing, error: sectionError } = await client.from("sections").select("id,title").eq("page_id", page.id).is("retired_at", null);
  if (sectionError) throw sectionError;
  assert(!existing.some((section: { title: string }) => section.title === "History"), "History already exists; inspect before retrying");
  const units = [];
  for (const section of existing) units.push(...(await db.call("read_section_state", { p_section_id: section.id })).units);
  const { readModelChoice } = await runtime.ssrLoadModule("/lib/ai/models.ts");
  const { tokenFactoryFromEnv } = await runtime.ssrLoadModule("/lib/ai/chat.ts");
  const settings = tokenFactoryFromEnv(process.env, await readModelChoice(db), (call: unknown) => db.call("log_ai_call", { p_call: call }));
  assert(settings);
  const { externalProjectContext, externalReviewRecorder } = await runtime.ssrLoadModule("/lib/knowledge/externalReviewStore.ts");
  const { approveExternalSource } = await runtime.ssrLoadModule("/lib/knowledge/externalApproval.ts");
  const context = await externalProjectContext(client, page, "History", units);
  const source = {
    title: "Utilitek Solutions Inc. — company LinkedIn profile (history)",
    url: "https://ca.linkedin.com/company/utiliteksolutions",
    // Exact short excerpts observed on the company's public profile, Oct 17 2026.
    text: "Since 2014, Utilitek Solutions has helped modernize electrical distribution systems.\n\nFounded\n2014",
  };
  const directory = resolve("artifacts/utilitek-live-history", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "source.json"), JSON.stringify(source, null, 2));
  const proposal = { needed: true, gap: "The user requests a little company history; the article has no founding date.", justification: "Use the company's own profile to add an attributed founding year and early business focus, without inferring company age from combined staff experience.", query: "Utilitek Solutions Inc founding history" };
  const approved = await approveExternalSource(settings, context, proposal, source, externalReviewRecorder(client, page.id, null));
  assert(approved, "The external history evidence was not approved");
  const { startExternalSource, processExternalEvent } = await runtime.ssrLoadModule("/lib/ingest/index.ts");
  const { ensureStakeholdersTopic } = await runtime.ssrLoadModule("/lib/knowledge/stakeholderExternal.ts");
  await ensureStakeholdersTopic(client);
  const started = await startExternalSource({ ...source, text: approved.text, sourceDate: "2026-10-17", reviewId: approved.reviewId });
  await writeFile(resolve(directory, "source-import.json"), JSON.stringify({ started, approved }, null, 2));
  console.log(JSON.stringify({ directory, sourceId: started.sourceId, stage: "Extracting approved history" }));
  let eventId = started.eventId;
  if (started.kind === "skipped") {
    const { data: event, error: eventError } = await client.from("shift_events").select("id").eq("source_id", started.sourceId).eq("cause", "upload").order("created_at", { ascending: false }).limit(1).single();
    if (eventError) throw eventError;
    eventId = event.id;
  }
  await processExternalEvent(eventId, { article: page.title, section: "History", note: "The user asks for a little history. Extract only the company's self-reported founding in 2014 and work modernizing electrical distribution since 2014. Preserve company attribution. File under the existing Stakeholders reference topic. Do not infer a founding date from experience claims." }, approved.reviewId);
  const { data: links, error: linksError } = await client.from("source_units").select("unit_id").eq("source_id", started.sourceId);
  if (linksError) throw linksError;
  const unitIds = [...new Set(links.map((link: { unit_id: string }) => link.unit_id))];
  assert(unitIds.length, "No approved history claims were saved");
  const { submitChangeSet, commitChangeSet } = await runtime.ssrLoadModule("/lib/change-control/index.ts");
  const submitted = await submitChangeSet(db, { eventId: null, cause: "edit", actor: "ai" }, {
    summary: "Added a short, source-backed Utilitek history at the user's request",
    actions: [{ type: "create_section", targetId: null, expectedRevisionId: null, passageIds: [], speechAct: null, input: { pageId: page.id, title: "History", position: 2, query: { unitIds, article: true } } }],
    trace: { modelVersion: null, promptVersion: "user-requested-company-history-v1", tokensIn: 0, tokensOut: 0 },
  });
  assert.equal((await commitChangeSet(db, submitted.changeSetId)).status, "applied");
  const { data: created, error: createdError } = await client.from("actions").select("target_id").eq("change_set_id", submitted.changeSetId).eq("type", "create_section").single();
  if (createdError) throw createdError;
  await writeFile(resolve(directory, "application.json"), JSON.stringify({ changeSetId: submitted.changeSetId, sectionId: created.target_id }, null, 2));
  const { refreshSectionStyle } = await runtime.ssrLoadModule("/lib/living-page/refreshStyle.ts");
  await refreshSectionStyle(db, writer, created.target_id, "Write one short history paragraph. Attribute 2014 to the company's own LinkedIn profile. Do not repeat headquarters, services, ownership or experience claims from the introduction or profile.");
  const after = await db.call("read_section_state", { p_section_id: created.target_id });
  await writeFile(resolve(directory, "after.json"), JSON.stringify(after, null, 2));
  console.log(JSON.stringify({ directory, sectionId: created.target_id, text: after.lines.map((line: { content: string }) => line.content) }));
} finally { await runtime.close(); }
