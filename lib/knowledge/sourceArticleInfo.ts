import "server-only";
import { z } from "zod";
import { chatJson, tokenFactoryFromEnv } from "@/lib/ai/chat";
import { readModelChoice } from "@/lib/ai/models";
import { commitPersonEdit } from "@/lib/change-control";
import { SOURCER_INSTRUCTIONS } from "@/lib/ai/sourcerPolicy";
import { loadRoleInstructions } from "@/lib/ai/skills/server";
import { getServerDeps } from "@/lib/server/deps";
import { getAdminSupabase } from "@/lib/supabase/admin";
import { startExternalSource, processExternalEvent } from "@/lib/ingest";
import type { SectionState } from "@/lib/living-page";
import { approveExternalSource } from "./externalApproval";
import { externalProjectContext, externalReviewRecorder } from "./externalReviewStore";
import { searchWebAndWikipedia, webSearchKey } from "./webSearch";
import { expandSourcedArticle } from "./expandSourcedArticle";

const querySchema = z.object({ query: z.string().trim().min(1).max(200), wikipediaQuery: z.string().trim().min(1).max(120).describe("A short encyclopedia topic to check on Wikipedia; omit web search operators."), gap: z.string().trim().min(1).max(1500), justification: z.string().trim().min(1).max(2000) });

export async function sourceArticleInfo(pageId: string, note: string, sectionId?: string) {
  const startedAt = performance.now();
  const deps = await getServerDeps(), client = getAdminSupabase();
  const configured = tokenFactoryFromEnv(process.env, await readModelChoice(deps.db), (call) => deps.db.call("log_ai_call", { p_call: call }));
  if (!configured) throw new Error("Configure an AI provider in Settings first.");
  const { data: page, error } = await client.from("pages").select("id,title,entity_id,context_entity_id").eq("id", pageId).is("retired_at", null).single();
  if (error) throw new Error("This article is no longer available.");
  let sectionQuery = client.from("sections").select("id,title").eq("page_id", pageId).is("retired_at", null);
  if (sectionId) sectionQuery = sectionQuery.eq("id", sectionId);
  const { data: sections, error: sectionsError } = await sectionQuery;
  if (sectionsError) throw new Error(sectionsError.message);
  if (sectionId && !sections?.length) throw new Error("This section is no longer available in this article.");
  const states: SectionState[] = [];
  for (const section of sections ?? []) states.push(await deps.db.call<SectionState>("read_section_state", { p_section_id: section.id }));
  const sectionTitle = sectionId ? sections![0]!.title : "External information";
  const context = await externalProjectContext(client, page, sectionTitle, states.flatMap((state) => state.units));
  let visibleQuery = client.from("section_lines").select("content").eq("page_id", pageId);
  if (sectionId) visibleQuery = visibleQuery.eq("section_id", sectionId);
  const visible = await visibleQuery;
  if (visible.error) throw new Error(visible.error.message);
  // Legacy or explicitly selected paragraphs can remain visible after their
  // query's current candidate set changes. The search must see that text too.
  const displayed = (visible.data ?? []).flatMap((line) => line.content ? [line.content] : []);
  context.articleText = displayed.join("\n\n").slice(0, 20000);
  context.existingKnowledge = [...new Set([...context.existingKnowledge, ...displayed])].slice(0, 80);
  const settings = { ...configured, roleInstructions: await loadRoleInstructions(deps.db) };
  const instructions = settings.roleInstructions.find((row) => row.role === "sourcer")?.instructions ?? SOURCER_INSTRUCTIONS;
  const record = externalReviewRecorder(client, page.id, sectionId ?? null);
  const proposed = await chatJson(settings, {
    name: "sourcer_research", subject: page.title, schema: querySchema, jsonSchema: z.toJSONSchema(querySchema), maxTokens: 2500,
    messages: [{ role: "system", content: instructions }, { role: "user", content: JSON.stringify({ context, userRequest: note || `Add useful external information about ${page.title}${sectionId ? `, specifically the section ${sectionTitle}` : ""}.`, scope: sectionId ? "Only find information relevant to this section; do not broaden to other article sections." : "Article", preapproved: true }) }],
  });
  const research = { ...proposed.value, needed: true };
  await record({ stage: "search", outcome: "approved", context, proposal: research, reason: "The user explicitly requested Add External Info and preapproved search and import.", url: null, sourceTitle: null, excerpts: [], model: proposed.model, tokensIn: proposed.tokensIn, tokensOut: proposed.tokensOut,
    attribution: { proposedBy: { role: "sourcer", model: proposed.model }, decidedBy: { role: "person", model: null }, instructions: { proposer: instructions, reviewer: "User-preapproved search and import." }, version: 1 } });
  const saved: { id: string; title: string; url: string }[] = [];
  let pending = 0, knowledge = 0;
  const sourcedUnits = new Set<string>();
  const seen = new Set<string>();
  const processSource = async (eventId: string, reviewId: string) => {
    const path = "External references";
    const domain = await client.from("domains").select("id").eq("path", path).is("retired_at", null).maybeSingle();
    if (domain.error) throw new Error(domain.error.message);
    if (!domain.data) {
      const created = await commitPersonEdit(deps.db, "Added reference topic for user-requested external information", [{ type: "create_domain", targetId: null, expectedRevisionId: null, passageIds: [], speechAct: null, input: { name: path, path, parentPath: null } }]);
      if (created.status !== "applied") throw new Error("Could not create the external reference topic.");
    }
    const processed = await processExternalEvent(eventId, { article: page.title, section: context.section, note: `${note}\nFile new knowledge under the existing External references topic.`, fallbackDomainPath: path }, reviewId);
    if (processed.status !== "applied") pending++;
  };
  const candidates = await searchWebAndWikipedia(webSearchKey(), research.query, proposed.value.wikipediaQuery || page.title);
  // Prefer official primary sources without hard-coding the article's topic.
  const priority = (url: string) => /\.(?:gov|gc\.ca|gov\.[a-z]{2})(?:\/|$)|\/\/[^/]*ccohs\.ca\//i.test(url) ? 1 : 0;
  candidates.sort((a, b) => priority(b.url) - priority(a.url));
  for (const result of candidates.slice(0, 8)) {
    if (seen.has(result.url)) continue;
    seen.add(result.url);
    const existing = await client.from("sources").select("id").eq("url", result.url).is("archived_at", null).limit(1);
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data?.length) {
      const sourceId = existing.data[0]!.id;
      const approval = await client.from("external_source_reviews").select("id").eq("source_id", sourceId).eq("page_id", pageId).eq("context->>section", context.section).eq("stage", "source").eq("outcome", "approved").is("reverted_at", null).limit(1);
      if (approval.error) throw new Error(approval.error.message);
      if (!approval.data?.length) continue;
      const failed = await client.from("shift_events").select("id").eq("source_id", sourceId).eq("status", "failed").limit(1);
      if (failed.error) throw new Error(failed.error.message);
      if (!failed.data?.length) continue;
      // Retry extraction from the already checked source, without uploading it twice.
      await processSource(failed.data[0]!.id, approval.data[0]!.id);
      saved.push({ id: sourceId, title: result.title, url: result.url });
      const units = await client.from("source_units").select("unit_id").eq("source_id", sourceId);
      if (units.error) throw new Error(units.error.message);
      for (const unit of units.data ?? []) if (unit.unit_id) sourcedUnits.add(unit.unit_id);
      knowledge = sourcedUnits.size;
      if (knowledge) break;
      continue;
    }
    // This is an automatic factual/excerpt check, not another permission prompt.
    const approved = await approveExternalSource(settings, context, research, result, record, "sourcer");
    if (!approved) continue;
    const date = result.publishedDate && !Number.isNaN(Date.parse(result.publishedDate)) ? new Date(result.publishedDate).toISOString() : new Date().toISOString();
    const started = await startExternalSource({ title: result.title, url: result.url, text: approved.text, sourceDate: date.slice(0, 10), reviewId: approved.reviewId });
    saved.push({ id: started.sourceId, title: result.title, url: result.url });
    if (started.kind === "started") {
      await processSource(started.eventId, approved.reviewId);
    }
    const units = await client.from("source_units").select("unit_id").eq("source_id", started.sourceId);
    if (units.error) throw new Error(units.error.message);
    for (const unit of units.data ?? []) if (unit.unit_id) sourcedUnits.add(unit.unit_id);
    knowledge = sourcedUnits.size;
    // One useful new source per click keeps the request bounded; another click
    // seeks the next unsaved source instead of reimporting the same URL.
    if (knowledge) break;
  }
  const sectionsAdded = await expandSourcedArticle({ db: deps.db, client, settings, writer: deps.writer }, pageId, [...sourcedUnits], note, sectionId ? sectionTitle : undefined);
  return { sources: saved, knowledge, pending, sectionsAdded, elapsedMs: Math.round(performance.now() - startedAt) };
}
