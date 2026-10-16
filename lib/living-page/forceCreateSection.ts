import "server-only";

import { z } from "zod";
import { chatJson, type TokenFactorySettings } from "@/lib/ai/chat";
import { skillInstructions } from "@/lib/ai/skills/prompt";
import { loadRoleInstructions } from "@/lib/ai/skills/server";
import type { DraftAction, SectionQuery } from "@/lib/ai/types";
import { commitChangeSet, submitChangeSet } from "@/lib/change-control";
import type { DbRpc } from "@/lib/db/rpc";
import { processExternalEvent, startExternalSource } from "@/lib/ingest";
import { searchWeb } from "@/lib/knowledge/webSearch";
import { approveExternalSearch, approveExternalSource } from "@/lib/knowledge/externalApproval";
import { externalProjectContext, externalReviewRecorder } from "@/lib/knowledge/externalReviewStore";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { discoveryQueries } from "./discoverArticleUpdates";
import { rebuildSection, type SectionState, type SectionWriter } from "./index";

// =====================================================================
// FORCE CREATE: builds out one section from everything that fits its
// heading. The AI picks the saved (internal) claims that belong under it;
// when the web is allowed it also searches, stores the top pages as
// external sources, adds their claims, and picks from those too. The
// section is then replaced, in place, by one showing the picked claims
// (retire + create in one ChangeSet, so Changes can undo it), and built.
// =====================================================================

export type ForceCreateDeps = { db: DbRpc; client: AdminSupabase; settings: TokenFactorySettings; writer: SectionWriter; webSearchKey: string | null };
export type ForceCreateResult = { sectionId: string; internal: number; external: number; sources: { title: string; url: string }[] };

const BATCH = 50;
const MAX_CANDIDATES = 300;
const NO_PERSON: Pick<DraftAction, "expectedRevisionId" | "passageIds" | "speechAct"> = { expectedRevisionId: null, passageIds: [], speechAct: null };

const pickSchema = z.object({ claims: z.array(z.string()) });

type Candidate = { unitId: string; content: string; external: boolean };

export async function forceCreateSection(deps: ForceCreateDeps, sectionId: string, note: string, useWeb: boolean, automatic = false): Promise<ForceCreateResult> {
  const { db, client } = deps;
  const { data: section, error } = await client.from("sections").select("id, page_id, position, title, query, mode").eq("id", sectionId).is("retired_at", null).single();
  if (error) throw new Error("This section is no longer available. Reload the page and try again.");
  if (section.mode !== "generated") throw new Error("Force Create only works on generated sections.");
  const state = await db.call<SectionState>("read_section_state", { p_section_id: sectionId });
  if (state.lines.some((line) => line.author === "person")) throw new Error("This section has text you wrote. Use Update instead, so your lines stay as they are.");
  const { data: page, error: pageError } = await client.from("pages").select("id, title, entity_id, context_entity_id").eq("id", section.page_id).single();
  if (pageError) throw new Error(pageError.message);

  const current = new Set(state.units.map((unit) => unit.unitId));
  const internal = await internalCandidates(deps, page, current);
  const sources: ForceCreateResult["sources"] = [];
  const external: Candidate[] = [];
  if (useWeb) {
    deps = { ...deps, settings: { ...deps.settings, roleInstructions: await loadRoleInstructions(db) } };
    const record = externalReviewRecorder(client, page.id, sectionId);
    const context = await externalProjectContext(client, page, section.title, [...state.units, ...internal]);
    const recent = automatic ? await client.from("external_source_reviews").select("id").eq("page_id", page.id).eq("stage", "search").eq("context->>section", section.title).gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).limit(1) : { data: [], error: null };
    if (recent.error) throw new Error(recent.error.message);
    const research = recent.data?.length ? null : await approveExternalSearch(deps.settings, context, note, record);
    for (const result of research ? await searchWeb(deps.webSearchKey, research.query) : []) {
      const scope = { article: page.title, section: section.title, note };
      const { data: existing, error: existingError } = await client.from("sources").select("id").eq("origin", "external").eq("url", result.url).is("archived_at", null).limit(1);
      if (existingError) throw new Error(existingError.message);
      if (existing?.length) {
        await record({ stage: "source", outcome: "rejected", context, proposal: research!, reason: "This URL is already saved. Reimporting it would duplicate an external source.", url: result.url, sourceTitle: result.title, excerpts: [], model: null });
        continue;
      }
      const approved = await approveExternalSource(deps.settings, context, research!, result, record);
      if (!approved) continue;
      const started = await startExternalSource({ title: result.title, url: result.url, text: approved.text, sourceDate: (result.publishedDate ?? new Date().toISOString()).slice(0, 10), reviewId: approved.reviewId });
      if (started.kind === "started") await processExternalEvent(started.eventId, scope, approved.reviewId);
      sources.push({ title: result.title, url: result.url });
      external.push(...(await sourceCandidates(client, started.sourceId, current)));
      // One accepted source per section; a second page must not broaden the fill.
      break;
    }
  }

  const candidates = [...internal.filter((unit) => !unit.external), ...external];
  const picked = await pickClaims(deps.settings, page.title, section.title, note, candidates);
  if (!picked.length && !current.size) {
    throw new Error(useWeb ? "Nothing found, saved or on the web, fits this section. Try a note that says what it should cover." : "No saved knowledge fits this section yet. Turn on Search the web to look further.");
  }

  const unitIds = [...new Set([...current, ...picked.map((unit) => unit.unitId)])];
  const query: SectionQuery = { ...((section.query ?? {}) as SectionQuery), unitIds };
  const actions: DraftAction[] = [
    { ...NO_PERSON, type: "retire_section", targetId: section.id, input: {} },
    { ...NO_PERSON, type: "create_section", targetId: null, input: { pageId: page.id, title: section.title, query, position: section.position } },
  ];
  const { changeSetId } = await submitChangeSet(db, { eventId: null, cause: "edit", actor: "ai" }, {
    summary: `Force created “${section.title}”`, actions,
    trace: { modelVersion: deps.settings.model ?? null, promptVersion: "force-create-section-v1", tokensIn: null, tokensOut: null },
  });
  const result = await commitChangeSet(db, changeSetId);
  if (result.status !== "applied") throw new Error("The section could not be replaced. Review Changes before retrying.");
  const { data: created, error: createdError } = await client.from("actions").select("target_id").eq("change_set_id", changeSetId).eq("type", "create_section").single();
  if (createdError || !created.target_id) throw new Error(createdError?.message ?? "The new section was not recorded.");
  const built = await rebuildSection(db, deps.writer, created.target_id, null);
  if (!built) throw new Error("The section was filled but is still being written. Reload the page in a moment.");

  const pickedIds = new Set(picked.map((unit) => unit.unitId));
  return { sectionId: created.target_id, internal: candidates.filter((unit) => pickedIds.has(unit.unitId) && !unit.external).length, external: candidates.filter((unit) => pickedIds.has(unit.unitId) && unit.external).length, sources };
}

// A generated section showing fewer saved claims than this is thin, so a web fill may add to it
export const THIN_SECTION_CLAIMS = 3;

// WEB FILL: force creates, with a web search, each thin generated section among sectionIds (at most
// maxSearches of them), so any AI that builds an article can reach past your own files when they fall
// short. Sections with your own lines are left alone, and one that finds nothing is skipped.
// Returns the ids of the sections that replaced the filled ones.
export async function fillThinSectionsFromWeb(deps: ForceCreateDeps, sectionIds: string[], note: string, maxSearches: number): Promise<string[]> {
  const filled: string[] = [];
  let attempts = 0;
  for (const sectionId of sectionIds) {
    if (attempts >= maxSearches) break;
    const { data: section } = await deps.client.from("sections").select("mode").eq("id", sectionId).is("retired_at", null).maybeSingle();
    if (section?.mode !== "generated") continue;
    const state = await deps.db.call<SectionState>("read_section_state", { p_section_id: sectionId });
    if (state.units.length >= THIN_SECTION_CLAIMS || state.lines.some((line) => line.author === "person")) continue;
    attempts++;
    try {
      filled.push((await forceCreateSection(deps, sectionId, note, true, true)).sectionId);
    } catch (error) {
      console.warn(`Web fill skipped section ${sectionId}:`, error instanceof Error ? error.message : error);
    }
  }
  return filled;
}

// SAVED CLAIMS IN THE ARTICLE'S SCOPE: its entity's claims and those under the other
// sections' topics, minus what this section already shows. Claims an earlier web search
// brought in stay marked external.
async function internalCandidates(deps: ForceCreateDeps, page: { id: string; entity_id: string | null; context_entity_id?: string | null }, current: Set<string>): Promise<Candidate[]> {
  const { db, client } = deps;
  const queries: SectionQuery[] = [];
  const entityId = page.context_entity_id ?? page.entity_id;
  if (entityId) {
    const { data: entity } = await client.from("entities").select("type, key").eq("id", entityId).single();
    if (entity) queries.push({ entity: { type: entity.type, key: entity.key } });
  }
  const { data: sections } = await client.from("sections").select("query").eq("page_id", page.id).is("retired_at", null);
  queries.push(...discoveryQueries((sections ?? []).map((row) => (row.query ?? {}) as SectionQuery)));
  const ids = new Set<string>();
  for (const query of queries) for (const id of await db.call<string[]>("living_page_query_units", { p_query: query })) if (!current.has(id)) ids.add(id);
  if (!ids.size) return [];
  const chosen = [...ids].slice(0, MAX_CANDIDATES);
  const { data: links, error } = await client.from("source_units").select("unit_id, source_id").in("unit_id", chosen);
  if (error) throw new Error(error.message);
  const { data: externalSources, error: sourceError } = await client.from("sources").select("id").eq("origin", "external");
  if (sourceError) throw new Error(sourceError.message);
  const externalSourceIds = new Set((externalSources ?? []).map((source) => source.id));
  const backedInternally = new Set((links ?? []).filter((link) => link.source_id && !externalSourceIds.has(link.source_id)).map((link) => link.unit_id));
  // A claim counts as external only when no person's own file backs it
  return withContents(client, chosen, (id) => !backedInternally.has(id));
}

// The live claims an external source produced
async function sourceCandidates(client: AdminSupabase, sourceId: string, current: Set<string>): Promise<Candidate[]> {
  const { data, error } = await client.from("source_units").select("unit_id").eq("source_id", sourceId);
  if (error) throw new Error(error.message);
  return withContents(client, (data ?? []).flatMap((row) => (row.unit_id && !current.has(row.unit_id) ? [row.unit_id] : [])), () => true);
}

async function withContents(client: AdminSupabase, ids: string[], isExternal: (id: string) => boolean): Promise<Candidate[]> {
  if (!ids.length) return [];
  const { data: units, error } = await client.from("units").select("id, current_revision_id").in("id", ids).is("retired_at", null).order("id");
  if (error) throw new Error(error.message);
  const { data: revisions, error: revisionError } = await client.from("revisions").select("id, content").in("id", (units ?? []).map((unit) => unit.current_revision_id));
  if (revisionError) throw new Error(revisionError.message);
  const contents = new Map((revisions ?? []).map((revision) => [revision.id, revision.content]));
  return (units ?? []).map((unit) => ({ unitId: unit.id, content: contents.get(unit.current_revision_id) ?? "", external: isExternal(unit.id) }));
}

// The candidates that belong under the heading, asked in bounded batches
async function pickClaims(settings: TokenFactorySettings, article: string, section: string, note: string, candidates: Candidate[]): Promise<Candidate[]> {
  const picked: Candidate[] = [];
  for (let offset = 0; offset < candidates.length; offset += BATCH) {
    const batch = candidates.slice(offset, offset + BATCH);
    const answer = await chatJson(settings, {
      name: "force_create_pick", schema: pickSchema, jsonSchema: z.toJSONSchema(pickSchema), maxTokens: 4000,
      messages: [
        { role: "system", content: `${skillInstructions(["plan_articles"], settings.skills)}\nChoose the claims that belong in ONE wiki section. Pick only claims that are directly about the section heading, within the article's subject. Return claims:[] when none fit. Use only supplied C refs. The optional note is editorial guidance, not evidence.` },
        { role: "user", content: JSON.stringify({ article, section, note, claims: batch.map((unit, index) => ({ ref: `C${index + 1}`, content: unit.content })) }) },
      ],
    });
    for (const ref of answer.value.claims) {
      const match = /^C([1-9]\d*)$/.exec(ref.trim());
      const unit = match ? batch[Number(match[1]) - 1] : undefined;
      if (unit && !picked.includes(unit)) picked.push(unit);
    }
  }
  return picked;
}
