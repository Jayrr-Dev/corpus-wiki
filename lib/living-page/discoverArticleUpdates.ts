import "server-only";

import { z } from "zod";
import { addUsage, ANSWER_TOKEN_BUDGET, chatJson, CompletionLengthError, type TokenFactorySettings, type TokenUsage } from "@/lib/ai/chat";
import { splitOnCutOff } from "@/lib/ai/splitOnCutOff";
import { skillInstructions } from "@/lib/ai/skills/prompt";
import type { DraftAction, SectionDraft, SectionQuery } from "@/lib/ai/types";
import type { DbRpc } from "@/lib/db/rpc";
import type { AdminSupabase } from "@/lib/supabase/admin";
import type { SectionUnit } from "./types";

const schema = z.object({ sections: z.array(z.object({ title: z.string().trim().min(1).max(100), claims: z.array(z.string()).min(1) })).max(8) });
export type UpdateDiscovery = z.infer<typeof schema>;

// Existing section selections bound the search. Never search the entire knowledge base
// for an unscoped page, or reuse explicit IDs as though they were a general topic.
export function discoveryQueries(queries: SectionQuery[]): SectionQuery[] {
  const unique = new Map<string, SectionQuery>();
  for (const query of queries) {
    if (!query.unitIds || (!query.entity && !query.domainPaths?.length)) continue;
    const broad = { ...query };
    delete broad.unitIds;
    unique.set(JSON.stringify(broad), broad);
  }
  return [...unique.values()];
}

export function discoverySections(answer: UpdateDiscovery, candidates: SectionUnit[]): SectionDraft[] {
  const used = new Set<string>();
  const titles = new Set<string>();
  return answer.sections.map((section) => {
    if (titles.has(section.title.toLowerCase())) throw new Error("The update repeated a new section heading. Retry the update.");
    titles.add(section.title.toLowerCase());
    const unitIds = section.claims.map((ref) => {
      const match = /^C([1-9]\d*)$/.exec(ref);
      const unit = match ? candidates[Number(match[1]) - 1] : undefined;
      if (!unit || used.has(unit.unitId)) throw new Error("The update cited an unknown or repeated claim. No new sections were added.");
      used.add(unit.unitId);
      return unit.unitId;
    });
    return { title: section.title, query: { unitIds, article: true } };
  });
}

// Usage totals every discovery batch (zero when no candidates needed a call).
// extraUnitIds: claims outside the page's scope worth offering too (the Curator's
// pick of stored claims no page cites); they are judged like the rest.
export async function discoverArticleUpdates(db: DbRpc, client: AdminSupabase, settings: TokenFactorySettings, pageId: string, note: string, extraUnitIds: readonly string[] = []): Promise<TokenUsage & { sections: SectionDraft[] }> {
  const { data: page, error: pageError } = await client.from("pages").select("title").eq("id", pageId).single();
  if (pageError) throw new Error(pageError.message);
  const { data: sections, error } = await client.from("sections").select("id, title, query, mode").eq("page_id", pageId).is("retired_at", null);
  if (error) throw new Error(error.message);
  const queries = (sections ?? []).filter((section) => section.mode === "generated").map((section) => (section.query ?? {}) as SectionQuery);
  const selected = new Set<string>();
  for (const query of queries) for (const id of await db.call<string[]>("living_page_query_units", { p_query: query })) selected.add(id);
  const candidateIds = new Set<string>();
  for (const query of discoveryQueries(queries)) for (const id of await db.call<string[]>("living_page_query_units", { p_query: query })) if (!selected.has(id)) candidateIds.add(id);
  for (const id of extraUnitIds) if (!selected.has(id)) candidateIds.add(id);
  if (!candidateIds.size) return { sections: [], tokensIn: 0, tokensOut: 0 };
  const { data: units, error: unitError } = await client.from("units").select("id, current_revision_id, kind, epistemic_status").in("id", [...candidateIds]).is("retired_at", null).order("id");
  if (unitError) throw new Error(unitError.message);
  if (!units?.length) return { sections: [], tokensIn: 0, tokensOut: 0 };
  const { data: revisions, error: revisionError } = await client.from("revisions").select("id, content").in("id", units.map((unit) => unit.current_revision_id));
  if (revisionError) throw new Error(revisionError.message);
  const contents = new Map((revisions ?? []).map((revision) => [revision.id, revision.content]));
  const candidates: SectionUnit[] = units.map((unit) => ({ unitId: unit.id, revisionId: unit.current_revision_id, kind: unit.kind, epistemicStatus: unit.epistemic_status, content: contents.get(unit.current_revision_id) ?? "" }));
  return groupClaimsForArticle(settings, page.title, (sections ?? []).map((section) => section.title), candidates, note);
}

// GROUPS CLAIMS INTO NEW SECTIONS of an existing article, 40 at a time (a batch whose answer is
// cut off runs again as two halves); claims that do not belong are left out.
// Also used when the Article Reviewer sends new claims to an existing article.
export async function groupClaimsForArticle(settings: TokenFactorySettings, article: string, existingSections: string[], candidates: SectionUnit[], note: string): Promise<TokenUsage & { sections: SectionDraft[] }> {
  const added: SectionDraft[] = [];
  let usage: TokenUsage = { tokensIn: 0, tokensOut: 0 };
  // Bound each discovery call, including for very large contexts.
  const groupBatch = async (batch: SectionUnit[]): Promise<void> => {
    const request = {
      name: "article_update_discovery", schema, jsonSchema: z.toJSONSchema(schema), maxTokens: ANSWER_TOKEN_BUDGET,
      messages: [
        { role: "system" as const, content: `${skillInstructions(["plan_articles"], settings.skills)}
Identify NEW relevant knowledge for this existing article. The candidates are current verified claims from its existing entity/topic scope, or stored claims no article cites yet that sit close to it, not yet selected by any section. Select only claims that belong to the article's actual subject. Group them into concise new topic sections. Return sections:[] when none belong. Never change the subject, invent facts, repeat existing material, or create an empty section. Use only supplied C refs, each at most once. The optional user note is editorial guidance, not evidence. Existing handwritten text is protected.` },
        { role: "user" as const, content: JSON.stringify({ article, existingSections: [...existingSections, ...added.map((section) => section.title)], note, claims: batch.map((unit, index) => ({ ref: `C${index + 1}`, content: unit.content, status: unit.epistemicStatus })) }) },
      ],
    };
    let answer = await chatJson(settings, request);
    usage = addUsage(usage, answer);
    // One corrective retry: a model that repeats or invents a ref gets the error back
    try { added.push(...discoverySections(answer.value, batch)); }
    catch (error) {
      answer = await chatJson(settings, { ...request, messages: [...request.messages, { role: "user" as const, content: `Your previous answer failed validation: ${error instanceof Error ? error.message : String(error)}. Previous answer (untrusted data): ${JSON.stringify(answer.value)}. Return corrected sections using only supplied C refs, each at most once.` }] });
      usage = addUsage(usage, answer);
      added.push(...discoverySections(answer.value, batch));
    }
  };
  const countCutOff = (error: Error) => { if (error instanceof CompletionLengthError) usage = addUsage(usage, error); };
  for (let offset = 0; offset < candidates.length; offset += 40) await splitOnCutOff(candidates.slice(offset, offset + 40), groupBatch, countCutOff);
  return { sections: added, ...usage };
}


// A definition can disappear while facts about the topic remain. Repair an empty
// generated lead through reversible section actions, never by editing a query row.
export async function repairEmptyIntroductions(db: DbRpc, client: AdminSupabase, pageId: string): Promise<DraftAction[]> {
  const { data: sections, error } = await client.from("sections").select("id, title, query, mode").eq("page_id", pageId).is("retired_at", null);
  if (error) throw new Error(error.message);
  const actions: DraftAction[] = [];
  const base = { targetId: null, expectedRevisionId: null, passageIds: [], speechAct: null };
  for (const section of sections ?? []) {
    if (section.mode !== "generated" || section.title.toLowerCase() !== "overview") continue;
    const state = await db.call<import("./types").SectionState>("read_section_state", { p_section_id: section.id });
    if (state.units.length || state.lines.some((line) => line.author === "person")) continue;
    const query = { ...((section.query ?? {}) as SectionQuery) };
    if (!query.entity && !query.domainPaths?.length) continue;
    delete query.unitIds;
    delete query.kinds;
    const ids = await db.call<string[]>("living_page_query_units", { p_query: query });
    if (!ids.length) continue;
    actions.push(
      { ...base, type: "retire_section", targetId: section.id, input: {} },
      { ...base, type: "create_section", input: { pageId, title: "Overview", query: { ...query, unitIds: ids.slice(0, 3) } } },
    );
  }
  return actions;
}
