import "server-only";

import { chatJson, type TokenFactorySettings } from "@/lib/ai/chat";
import {
  buildWebProfileMessages,
  buildWebQueryMessages,
  readWebProfiles,
  readWebQueries,
  buildWebSiteMessages,
  officialSite,
  siteNamesParty,
  readWebSites,
  WEB_BATCH_SIZE,
  webSiteAnswerJsonSchema,
  webSiteAnswerSchema,
  type WebProfile,
  type WebResult,
  type WebSubject,
  webHash,
  webProfileAnswerJsonSchema,
  webProfileAnswerSchema,
  webQueryAnswerJsonSchema,
  webQueryAnswerSchema,
} from "@/lib/ai/tokenFactory/entityWeb";
import { supabaseRpc } from "@/lib/db/rpc";
import { assertActiveUpload, uploadExecution, workflowStep } from "@/lib/ingest/workflowContext";
import { mapConcurrent } from "@/lib/processing/concurrency";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { fetchLogo } from "./logoFetch";
import { searchSnippets, webSearchKey, wikipediaOfficialSite } from "./webSearch";
import { withWikidataSizes } from "./wikidataSizes";

// =====================================================================
// STAKEHOLDER WEB LOOKUP (server side): runs when external knowledge is
// allowed (/settings), for stakeholders not yet looked up under their
// current name and kind: after an upload writes their cards, and from the
// Stakeholders page. A sure match is stored on the card (entity_profiles.web)
// with its logo; no match stores nothing but the check, so it is not
// searched again until the name or kind changes or a person asks.
// =====================================================================

type Deps = { client: AdminSupabase; settings: TokenFactorySettings };
export type WebBatchResult = { found: number; checked: number; logos: number };

const LOGO_BUCKET = "logos";

export async function webLookupAllowed(client: AdminSupabase): Promise<boolean> {
  const settings = await supabaseRpc(client).call<{ allowExternalKnowledge?: boolean }>("get_workspace_settings");
  return settings.allowExternalKnowledge === true;
}

type CardRow = { entity_id: string; kind: string | null; relation: string | null; key_facts: unknown; web_hash: string | null; logo_url: string | null; entities: { name: string; type: string; aliases: string[]; retired_at: string | null; merged_into_id: string | null } | null };

async function readSubjects(client: AdminSupabase, entityIds: string[] | null): Promise<(WebSubject & { hash: string; checkedHash: string | null; logoUrl: string | null })[]> {
  let query = client.from("entity_profiles").select("entity_id, kind, relation, key_facts, web_hash, logo_url, entities(name, type, aliases, retired_at, merged_into_id)").eq("is_stakeholder", true).eq("hidden", false);
  if (entityIds) query = query.in("entity_id", entityIds);
  const { data, error } = await query;
  if (error) throw error;
  return (data as unknown as CardRow[]).flatMap((row) => {
    const entity = row.entities;
    if (!entity || entity.retired_at || entity.merged_into_id) return [];
    const facts = Array.isArray(row.key_facts) ? (row.key_facts as { label?: string; value?: string }[]).map((fact) => `${fact.label ?? ""}: ${fact.value ?? ""}`) : [];
    const subject: WebSubject = { entityId: row.entity_id, name: entity.name, kind: row.kind || entity.type, aliases: entity.aliases, relation: row.relation, facts };
    return [{ ...subject, hash: webHash(subject), checkedHash: row.web_hash, logoUrl: row.logo_url }];
  }).sort((a, b) => a.entityId.localeCompare(b.entityId));
}

// PLAN (the Stakeholders page): batches of stakeholders to look up; `all` refreshes every one
// (Update cards), otherwise only those not yet looked up under their name and kind
export async function planWebBatches(client: AdminSupabase, all = false): Promise<string[][]> {
  if (!(await webLookupAllowed(client))) return [];
  const ids = (await readSubjects(client, null)).filter((subject) => all || subject.hash !== subject.checkedHash).map((subject) => subject.entityId);
  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += WEB_BATCH_SIZE) batches.push(ids.slice(index, index + WEB_BATCH_SIZE));
  return batches;
}

// AFTER AN UPLOAD WROTE CARDS: look up the new stakeholders among these entities
export async function lookUpNewStakeholders(deps: Deps, entityIds: string[]): Promise<void> {
  if (!entityIds.length || !(await webLookupAllowed(deps.client))) return;
  const plan = await workflowStep("web:plan", async () => {
    await assertActiveUpload();
    const ids = (await readSubjects(deps.client, entityIds)).filter((subject) => subject.hash !== subject.checkedHash).map((subject) => subject.entityId);
    const batches: string[][] = [];
    for (let index = 0; index < ids.length; index += WEB_BATCH_SIZE) batches.push(ids.slice(index, index + WEB_BATCH_SIZE));
    return { ids, batches };
  });
  await mapConcurrent(plan.batches, 2, async (batch) => {
    await assertActiveUpload();
    await workflowStep(`web:${batch.join(":")}`, () => lookUpWebBatch(deps, batch));
  }, uploadExecution.getStore()?.signal);
  // A confirmed page becomes external knowledge (approved, stored, reconciled) like any other
  const { saveStakeholderPage } = await import("./stakeholderExternal");
  for (const entityId of plan.ids) {
    await assertActiveUpload();
    try { await workflowStep(`web-save:${entityId}`, () => saveStakeholderPage(deps, entityId)); }
    catch (error) { await assertActiveUpload(); console.warn("Stakeholder page not saved:", error instanceof Error ? error.message : error); }
  }
}

// ONE BATCH: queries, searches, a sure-match check, then the cards and logos. `force` looks
// up again even when nothing changed (a person asked).
export async function lookUpWebBatch(deps: Deps, entityIds: string[], force = false): Promise<WebBatchResult> {
  if (!(await webLookupAllowed(deps.client))) throw new Error("External knowledge is turned off in Settings, so stakeholders are not looked up on the web.");
  const subjects = (await readSubjects(deps.client, entityIds)).filter((subject) => force || subject.hash !== subject.checkedHash);
  if (!subjects.length) return { found: 0, checked: 0, logos: 0 };

  const queries = readWebQueries((await chatJson(deps.settings, {
    name: "entity_web_queries", schema: webQueryAnswerSchema, jsonSchema: webQueryAnswerJsonSchema,
    messages: buildWebQueryMessages(subjects), reasoningEffort: "low",
  })).value, subjects);
  const key = webSearchKey();
  const results = new Map<string, WebResult[]>();
  await mapConcurrent(subjects, WEB_BATCH_SIZE, async (subject) => {
    const query = queries.get(subject.entityId);
    if (!query) return;
    try { results.set(subject.entityId, await searchSnippets(key, query)); } catch { await assertActiveUpload(); /* no results: nothing kept */ }
  }, uploadExecution.getStore()?.signal);
  const searched = subjects.filter((subject) => (results.get(subject.entityId) ?? []).length > 0);
  const answer = searched.length ? await chatJson(deps.settings, {
    name: "entity_web_profiles", schema: webProfileAnswerSchema, jsonSchema: webProfileAnswerJsonSchema,
    messages: buildWebProfileMessages(searched, results), reasoningEffort: "low",
  }) : null;
  const profiles: Map<string, WebProfile> = answer ? readWebProfiles(answer.value, searched, results) : new Map();
  // Overview pages (encyclopedias, maps) rarely are the party's own site. For a sure match without
  // one: first the official website its confirmed Wikipedia page records (Wikidata), then a search
  // for the site, from whose results the model picks the party's own site (or none)
  await mapConcurrent(subjects, WEB_BATCH_SIZE, async (subject) => {
    const profile = profiles.get(subject.entityId);
    const page = profile && !profile.website ? profile.sources.find((source) => /wikipedia\.org\/wiki\//.test(source.url)) : undefined;
    if (!page) return;
    try {
      const recorded = await wikipediaOfficialSite(page.url);
      const site = recorded ? officialSite(recorded, [{ title: "", url: recorded, content: "" }]) : null;
      if (site && siteNamesParty(site, subject)) profile!.website = site;
    } catch { await assertActiveUpload(); /* fall through to the search */ }
  }, uploadExecution.getStore()?.signal);
  const siteless = subjects.filter((subject) => profiles.get(subject.entityId) && !profiles.get(subject.entityId)!.website);
  const siteResults = new Map<string, WebResult[]>();
  await mapConcurrent(siteless, WEB_BATCH_SIZE, async (subject) => {
    try { siteResults.set(subject.entityId, await searchSnippets(key, `${subject.name} ${subject.kind} official website`, 5)); } catch { await assertActiveUpload(); /* no site: no logo */ }
  }, uploadExecution.getStore()?.signal);
  const withResults = siteless.filter((subject) => (siteResults.get(subject.entityId) ?? []).length > 0);
  if (withResults.length) {
    const summaries = new Map(withResults.map((subject) => [subject.entityId, profiles.get(subject.entityId)!.summary]));
    const picked = readWebSites((await chatJson(deps.settings, {
      name: "entity_web_sites", schema: webSiteAnswerSchema, jsonSchema: webSiteAnswerJsonSchema,
      messages: buildWebSiteMessages(withResults, summaries, siteResults), reasoningEffort: "low",
    })).value, withResults, siteResults);
    for (const [entityId, site] of picked) profiles.get(entityId)!.website = site;
  }
  // Sizes for the Power Level, from the Wikidata item of a sure match (docs/power-model.md)
  await mapConcurrent(subjects.filter((subject) => profiles.has(subject.entityId)), WEB_BATCH_SIZE, async (subject) => {
    profiles.set(subject.entityId, await withWikidataSizes(subject.name, profiles.get(subject.entityId)!));
  }, uploadExecution.getStore()?.signal);

  let logos = 0;
  const now = new Date().toISOString();
  for (const subject of subjects) {
    await assertActiveUpload();
    const profile = profiles.get(subject.entityId) ?? null;
    let logoUrl: string | null | undefined;
    if (profile?.website && (force || !subject.logoUrl)) {
      logoUrl = await storeLogo(deps.client, subject.entityId, profile.website);
      if (logoUrl) logos += 1;
    }
    await assertActiveUpload();
    // Nothing found keeps what an earlier lookup found (and its logo); a sure match replaces it
    const { error } = await deps.client.from("entity_profiles").update({
      ...(profile ? { web: profile } : {}),
      // A missed confirmation keeps the logo; only a newly confirmed site replaces it
      ...(logoUrl ? { logo_url: logoUrl } : {}),
      web_checked_at: now, web_hash: subject.hash, updated_at: now,
    }).eq("entity_id", subject.entityId);
    if (error) throw error;
  }
  return { found: profiles.size, checked: subjects.length, logos };
}

// The site's logo in the public bucket; a fresh query string makes browsers drop an old copy
async function storeLogo(client: AdminSupabase, entityId: string, website: string): Promise<string | null> {
  try {
    const logo = await fetchLogo(website);
    if (!logo) return null;
    const path = `${entityId}.${logo.extension}`;
    await assertActiveUpload();
    const { error } = await client.storage.from(LOGO_BUCKET).upload(path, logo.bytes, { contentType: logo.contentType, upsert: true });
    if (error) throw error;
    return `${client.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
  } catch (error) {
    await assertActiveUpload();
    console.warn("Stakeholder logo not stored:", error instanceof Error ? error.message : error);
    return null;
  }
}
