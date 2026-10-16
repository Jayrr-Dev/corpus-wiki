import "server-only";

import type { TokenFactorySettings } from "@/lib/ai/chat";
import { loadRoleInstructions } from "@/lib/ai/skills/server";
import { commitPersonEdit } from "@/lib/change-control";
import { supabaseRpc } from "@/lib/db/rpc";
import { processExternalEvent, startExternalSource } from "@/lib/ingest";
import type { WebContext } from "@/lib/stakeholders/cards";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { approveExternalSource, type ExternalProjectContext, type ResearchProposal } from "./externalApproval";
import { externalReviewRecorder } from "./externalReviewStore";
import { readWebPage, webSearchKey } from "./webSearch";
import { webLookupAllowed } from "./entityWeb";

// =====================================================================
// STAKEHOLDER WEB PAGES AS EXTERNAL KNOWLEDGE: once a stakeholder's web
// lookup is a sure match, its best page (its Wikipedia article, else its
// official site, else the first page used) goes through the same path as
// any external knowledge: a researcher picks excerpts, an independent
// reviewer approves them, the page is stored as an external source, and
// its claims are added (marked external, filed under reference topics,
// never revising your own). One page per stakeholder; a page already
// saved is not saved again. Scope: article "Stakeholder: <name>", section
// "Overview", so the approval and the claims stay tied to that card.
// =====================================================================

type Deps = { client: AdminSupabase; settings: TokenFactorySettings };
export type ExternalSaveResult = { saved: boolean; title: string | null; reason: string };

// THE REFERENCE TOPIC their claims are filed under: external knowledge may only use existing
// reference topics (never organization roots), so it is created once, as an audited edit
export const STAKEHOLDERS_TOPIC = "Stakeholders";

export const stakeholderScope = (name: string) => ({
  article: `Stakeholder: ${name}`, section: "Overview",
  note: `Extract who ${name} is as a whole, as claims about ${name}: what it is, its main business or mandate, ownership or parent, headquarters, founding, size, and where it operates. File them under the "${STAKEHOLDERS_TOPIC}" topic. Skip procedures, rules, products and news.`,
});

async function ensureStakeholdersTopic(client: AdminSupabase): Promise<void> {
  const { data, error } = await client.from("domains").select("id").eq("path", STAKEHOLDERS_TOPIC).is("retired_at", null).maybeSingle();
  if (error) throw error;
  if (data) return;
  const result = await commitPersonEdit(supabaseRpc(client), `Added topic: ${STAKEHOLDERS_TOPIC} (general facts about stakeholders, from the web)`, [{
    type: "create_domain", targetId: null, expectedRevisionId: null, passageIds: [], speechAct: null,
    input: { name: STAKEHOLDERS_TOPIC, path: STAKEHOLDERS_TOPIC, parentPath: null },
  }]);
  if (result.status !== "applied") throw new Error(`The ${STAKEHOLDERS_TOPIC} topic could not be created.`);
}

type Candidate = { entityId: string; name: string; kind: string; relation: string | null; web: WebContext };

async function readCandidates(client: AdminSupabase, entityIds: string[] | null): Promise<Candidate[]> {
  let query = client.from("entity_profiles").select("entity_id, kind, relation, web, entities(name, type, retired_at, merged_into_id)").eq("is_stakeholder", true).eq("hidden", false).not("web", "is", null);
  if (entityIds) query = query.in("entity_id", entityIds);
  const { data, error } = await query;
  if (error) throw error;
  type Row = { entity_id: string; kind: string | null; relation: string | null; web: unknown; entities: { name: string; type: string; retired_at: string | null; merged_into_id: string | null } | null };
  return (data as unknown as Row[]).flatMap((row) => {
    const entity = row.entities;
    const web = row.web as WebContext | null;
    if (!entity || entity.retired_at || entity.merged_into_id || !web?.sources?.length) return [];
    return [{ entityId: row.entity_id, name: entity.name, kind: row.kind || entity.type, relation: row.relation, web }];
  });
}

// The pages worth keeping, best first: the encyclopedia article, then pages on the official site,
// then the rest in the order the lookup used them
export function pagesByPreference(web: Pick<WebContext, "sources" | "website">): { title: string; url: string }[] {
  const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
  const rank = (url: string) => /(^|\.)wikipedia\.org$/.test(host(url)) ? 0 : web.website && host(url) === host(web.website) ? 1 : 2;
  return web.sources.map((source, index) => ({ source, index })).sort((a, b) => rank(a.source.url) - rank(b.source.url) || a.index - b.index).map(({ source }) => source);
}
export const bestPage = (web: Pick<WebContext, "sources" | "website">) => pagesByPreference(web)[0] ?? null;

// A page with less readable text than this (a script-rendered site) is skipped for the next one
const MIN_PAGE_CHARS = 600;
const MAX_PAGES_TRIED = 2;

// Stored external sources among these URLs (not archived)
async function savedUrls(client: AdminSupabase, urls: string[]): Promise<Set<string>> {
  if (!urls.length) return new Set();
  const { data, error } = await client.from("sources").select("url").eq("origin", "external").is("archived_at", null).in("url", urls);
  if (error) throw error;
  return new Set(data.flatMap((row) => (row.url ? [row.url] : [])));
}

// PLAN: stakeholders whose web context has no page saved as external knowledge yet
export async function planExternalSaves(client: AdminSupabase): Promise<string[]> {
  if (!(await webLookupAllowed(client))) return [];
  const candidates = await readCandidates(client, null);
  const saved = await savedUrls(client, candidates.flatMap((candidate) => candidate.web.sources.map((source) => source.url)));
  return candidates.filter((candidate) => !candidate.web.sources.some((source) => saved.has(source.url))).map((candidate) => candidate.entityId).sort();
}

// ONE STAKEHOLDER: approve, store and reconcile its best page
export async function saveStakeholderPage(deps: Deps, entityId: string): Promise<ExternalSaveResult> {
  if (!(await webLookupAllowed(deps.client))) throw new Error("External knowledge is turned off in Settings.");
  const [candidate] = await readCandidates(deps.client, [entityId]);
  if (!candidate) return { saved: false, title: null, reason: "Nothing on the web was confirmed for this stakeholder." };
  const saved = await savedUrls(deps.client, candidate.web.sources.map((source) => source.url));
  if (candidate.web.sources.some((source) => saved.has(source.url))) return { saved: false, title: null, reason: "Already saved as external knowledge." };
  await ensureStakeholdersTopic(deps.client);
  const settings = { ...deps.settings, roleInstructions: await loadRoleInstructions(supabaseRpc(deps.client)) };
  const scope = stakeholderScope(candidate.name);
  const ourName = await ourOrganizationName(deps.client);
  // What YOUR knowledge holds about it: its claims (the web summary is not knowledge, so it is left out)
  const storeSays = await knowledgeAbout(deps.client, entityId);
  const context: ExternalProjectContext = {
    organization: ourName, article: scope.article, section: scope.section,
    sourceTitles: [], projectFacts: storeSays, existingKnowledge: storeSays,
  };
  const research: ResearchProposal = {
    needed: true,
    gap: `The knowledge holds little about who ${candidate.name} (${candidate.kind}) is as a whole: what it is, what it does, who owns it, where it operates.`,
    justification: `${candidate.name} is a stakeholder in the work; a general profile from a confirmed page about it gives its card context.`,
    query: `${candidate.name} ${candidate.kind}`,
  };
  const record = externalReviewRecorder(deps.client, null, null);
  // Best page first; one that is unreadable, too thin, or not approved gives way to the next
  let tried = 0;
  let last: ExternalSaveResult = { saved: false, title: null, reason: "No page to save." };
  for (const page of pagesByPreference(candidate.web)) {
    if (tried >= MAX_PAGES_TRIED) break;
    const text = await readWebPage(webSearchKey(), page.url).catch(() => null);
    if (!text || text.length < MIN_PAGE_CHARS) { last = { saved: false, title: page.title, reason: "Its pages had too little readable text." }; continue; }
    tried += 1;
    const approved = await approveExternalSource(settings, context, research, { title: page.title, url: page.url, text }, record);
    if (!approved) { last = { saved: false, title: page.title, reason: "The independent reviewer did not approve its pages." }; continue; }
    const started = await startExternalSource({ title: page.title, url: page.url, text: approved.text, sourceDate: new Date().toISOString().slice(0, 10), reviewId: approved.reviewId });
    let eventId = started.kind === "started" ? started.eventId : null;
    if (!eventId) {
      // The same approved text is stored already: process it again only when it never yielded a claim
      eventId = await emptyStoredEvent(deps.client, started.sourceId);
      if (!eventId) return { saved: false, title: page.title, reason: "This page is already stored." };
    }
    await processExternalEvent(eventId, scope, approved.reviewId);
    return { saved: true, title: page.title, reason: "Saved as external knowledge." };
  }
  return last;
}

async function ourOrganizationName(client: AdminSupabase): Promise<string | null> {
  const settings = await supabaseRpc(client).call<{ ourEntityId?: string | null }>("get_workspace_settings");
  if (!settings.ourEntityId) return null;
  const { data } = await client.from("entities").select("name").eq("id", settings.ourEntityId).maybeSingle();
  return data?.name ?? null;
}

// The live claims about an entity, as the reviewer weighs a page against them
async function knowledgeAbout(client: AdminSupabase, entityId: string): Promise<string[]> {
  const links = await client.from("unit_entities").select("unit_id").eq("entity_id", entityId);
  if (links.error) throw links.error;
  const ids = links.data.map((link) => link.unit_id).slice(0, 60);
  if (!ids.length) return [];
  const units = await client.from("units").select("current_revision_id").in("id", ids).is("retired_at", null);
  if (units.error) throw units.error;
  const revisions = units.data.length ? await client.from("revisions").select("content").in("id", units.data.map((unit) => unit.current_revision_id)) : { data: [], error: null };
  if (revisions.error) throw revisions.error;
  return revisions.data.map((revision) => revision.content.slice(0, 1000)).slice(0, 32);
}

// A stored external page that yielded no live claim (e.g. saved before its topic existed): back
// in use, and its upload event to process again; null when it has claims or no event
async function emptyStoredEvent(client: AdminSupabase, sourceId: string): Promise<string | null> {
  const claims = await client.from("source_units").select("unit_id").eq("source_id", sourceId).limit(1);
  if (claims.error) throw claims.error;
  if (claims.data.length) return null;
  const event = await client.from("shift_events").select("id").eq("source_id", sourceId).eq("cause", "upload").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (event.error) throw event.error;
  if (!event.data) return null;
  const unarchived = await client.from("sources").update({ archived_at: null, archive_reason: null }).eq("id", sourceId).eq("origin", "external");
  if (unarchived.error) throw unarchived.error;
  return event.data.id;
}
