import { createHash } from "node:crypto";
import { z } from "zod";
import type { ChatMessage } from "@/lib/ai/chat";

// =====================================================================
// STAKEHOLDER WEB CONTEXT: internal knowledge about a party is often thin
// at first, so each stakeholder is looked up on the web once. Two calls
// per batch: the model writes a search query that pins down WHICH party it
// is (from what the knowledge says), then reads the results and keeps a
// short profile only when it is sure the pages describe that same party.
// Nothing found, or not sure, keeps nothing. What it keeps is shown apart
// from the knowledge, with its links; it never becomes a claim.
// =====================================================================

export const WEB_PROMPT_VERSION = "entity-web-v2";
export const WEB_BATCH_SIZE = 5;

// WHAT THE LOOKUP KNOWS ABOUT EACH STAKEHOLDER (from its card)
export type WebSubject = { entityId: string; name: string; kind: string; aliases: string[]; relation: string | null; facts: string[] };
export type WebResult = { title: string; url: string; content: string };
export type WebProfile = { summary: string; facts: { label: string; value: string; sourceIndex: number | null }[]; website: string | null; sources: { title: string; url: string }[] };

// The name and kind a party is looked up under; a new name or kind looks it up again
export function webHash(subject: Pick<WebSubject, "name" | "kind">): string {
  return createHash("sha256").update(JSON.stringify({ v: WEB_PROMPT_VERSION, name: subject.name.trim().toLowerCase(), kind: subject.kind })).digest("hex");
}

// What the store says goes in as identification only ("storeSays"), never as material to restate
const subjectPayload = (subjects: WebSubject[]) => subjects.map((subject, index) => ({
  ref: `E${index + 1}`, name: subject.name, kind: subject.kind, aliases: subject.aliases,
  storeSays: [subject.relation ?? "", ...subject.facts].filter(Boolean),
}));

// ---------------------------------------------------------------------
// 1. QUERIES
// ---------------------------------------------------------------------

const queryAnswer = z.object({ queries: z.array(z.object({ ref: z.string(), query: z.string().default("") })) });
export const webQueryAnswerSchema = queryAnswer;
export const webQueryAnswerJsonSchema = z.toJSONSchema(queryAnswer);

const QUERY_PROMPT = `You look up stakeholders from a knowledge store on the web, to learn WHO each one is as a whole: what it is, what it does overall, who owns it, where it operates. For each one you get its name, kind, aliases, and what the store says about it (only to tell it apart from namesakes).

Answer with JSON only: { "queries": [{ "ref": "E1", "query": "..." }] }, one item per stakeholder.
- query: a short web search query (at most 8 words) for an OVERVIEW of this party: its name plus at most one or two words that tell it apart (industry, city or country). Example: "EPCOR utility company Edmonton", "DM&E precision machining manufacturer".
- Do NOT put the store's topics in the query (permits, procedures, safety rules, a project, a form): those find narrow pages instead of an overview.
- For a role (a job people hold), search for the role in general within its industry, e.g. "utility designer job role".
- Leave query empty only when nothing could tell it apart from other parties of the same name.`;

export function buildWebQueryMessages(subjects: WebSubject[]): ChatMessage[] {
  return [{ role: "system", content: QUERY_PROMPT }, { role: "user", content: JSON.stringify({ stakeholders: subjectPayload(subjects) }) }];
}

export function readWebQueries(answer: z.infer<typeof queryAnswer>, subjects: WebSubject[]): Map<string, string> {
  const byRef = new Map(subjects.map((subject, index) => [`E${index + 1}`, subject]));
  const queries = new Map<string, string>();
  for (const item of answer.queries) {
    const subject = byRef.get(item.ref.trim().toUpperCase());
    const query = item.query.replace(/\s+/g, " ").trim().slice(0, 200);
    if (subject && query) queries.set(subject.entityId, query);
  }
  return queries;
}

// ---------------------------------------------------------------------
// 2. PROFILES (only for sure matches)
// ---------------------------------------------------------------------

const profileAnswer = z.object({
  profiles: z.array(z.object({
    ref: z.string(),
    sameParty: z.boolean(),
    reason: z.string().default(""),
    summary: z.string().default(""),
    facts: z.array(z.object({ label: z.string(), value: z.string(), result: z.number().int().nullable().default(null) })).default([]),
    website: z.string().nullable().default(null),
    results: z.array(z.number().int()).default([]),
  })),
});
export const webProfileAnswerSchema = profileAnswer;
export const webProfileAnswerJsonSchema = z.toJSONSchema(profileAnswer);

const PROFILE_PROMPT = `You check web search results against what a knowledge store says about each stakeholder, and write a short general profile of the party from the results that are about the SAME party. The profile adds the big picture the store lacks; the store's own topics are already covered elsewhere.

Answer with JSON only: { "profiles": [{ "ref": "E1", "sameParty": true, "reason": "...", "summary": "...", "facts": [{ "label": "...", "value": "...", "result": 2 }], "website": "https://...", "results": [1, 2] }] }, one item per stakeholder.
- sameParty: true only when you are SURE some results describe this exact party (its name AND what the store says about it fit). A namesake, a different branch or country, or a vague match is false. When false, leave every other field empty.
- reason: one short sentence on why it is or is not the same party.
- summary: what the party is AS A WHOLE, in one or two plain sentences (at most 45 words): its type, main business or mandate, where it operates, ownership. Write it the way an encyclopedia's first lines would. Never describe a narrow procedure, rule, guideline or project, and never repeat what the store already says ("storeSays"). For a role, what people in that role do in general.
- facts: at most 5 identity facts a reader wants at a glance (label of 1 to 3 words, value of at most 15 words), only of these sorts: headquarters, founded, ownership or parent, industry, main services or business lines, size (employees, customers, revenue), service area, jurisdiction, mandate. No rules, thresholds, clearances, procedures, contact numbers or anything already in "storeSays". result = the number of the result it came from.
- A result that is only about a narrow topic (a handbook page, a form, a guideline) may confirm identity but is not a source for the summary or facts.
- website: the party's own official website when a matching result is it or links to it; otherwise null. Never guess a domain. Always null for a role or job, and for a country unless it is the national government's own site.
- results: the numbers of the results you used.
- Use only the results. No outside knowledge.`;

export function buildWebProfileMessages(subjects: WebSubject[], results: Map<string, WebResult[]>): ChatMessage[] {
  const payload = subjectPayload(subjects).map((item, index) => ({
    ...item,
    results: (results.get(subjects[index]!.entityId) ?? []).map((result, r) => ({ number: r + 1, title: result.title, url: result.url, text: result.content })),
  }));
  return [{ role: "system", content: PROFILE_PROMPT }, { role: "user", content: JSON.stringify({ stakeholders: payload }) }];
}

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
};

// ANSWER -> a profile for each sure match (absent: nothing kept for it)
export function readWebProfiles(answer: z.infer<typeof profileAnswer>, subjects: WebSubject[], results: Map<string, WebResult[]>): Map<string, WebProfile> {
  const byRef = new Map(subjects.map((subject, index) => [`E${index + 1}`, subject]));
  const profiles = new Map<string, WebProfile>();
  for (const item of answer.profiles) {
    const subject = byRef.get(item.ref.trim().toUpperCase());
    if (!subject || !item.sameParty || profiles.has(subject.entityId)) continue;
    const found = results.get(subject.entityId) ?? [];
    const used = [...new Set(item.results)].filter((n) => found[n - 1]);
    const summary = clip(item.summary, 320);
    if (!summary || !used.length) continue;
    // Source numbers on facts follow the kept sources list
    const sources = used.map((n) => ({ title: clip(found[n - 1]!.title, 120), url: found[n - 1]!.url }));
    const facts = item.facts.filter((fact) => fact.label.trim() && fact.value.trim()).slice(0, 5).map((fact) => {
      const at = fact.result === null ? -1 : used.indexOf(fact.result);
      return { label: clip(fact.label, 40), value: clip(fact.value, 140), sourceIndex: at >= 0 ? at : null };
    });
    const website = officialSite(item.website, found);
    profiles.set(subject.entityId, { summary, facts, website: website && siteNamesParty(website, subject) ? website : null, sources });
  }
  return profiles;
}

// The official site, only when it is a plain http(s) address that one of the results is on
export function officialSite(website: string | null, results: WebResult[]): string | null {
  if (!website) return null;
  let url: URL;
  try { url = new URL(website.trim()); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.replace(/^www\./, "");
  const onResults = results.some((result) => {
    try { return new URL(result.url).hostname.replace(/^www\./, "") === host; } catch { return false; }
  });
  return onResults ? `${url.protocol}//${url.hostname}` : null;
}

// A site is the party's own only when its domain carries the party's name: a word of its name
// or an alias (3+ letters), or its acronym. "Labour Program" is not whmis.org; ASQ is asq.org.
const NAME_SKIPS = new Set(["the", "and", "for", "inc", "ltd", "llc", "corp", "company", "group", "companies", "solutions", "services", "program", "department", "office"]);
export function siteNamesParty(website: string, subject: Pick<WebSubject, "name" | "aliases">): boolean {
  let host: string;
  try { host = new URL(website).hostname.toLowerCase().replace(/^www\./, ""); } catch { return false; }
  const labels = host.split(".").slice(0, -1).join(".");
  const tokens = new Set<string>();
  for (const name of [subject.name, ...subject.aliases]) {
    const words = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9& ]+/g, " ").split(/\s+/).filter(Boolean);
    for (const word of words) if (word.length >= 3 && !NAME_SKIPS.has(word)) tokens.add(word.replace(/&/g, ""));
    const initials = words.filter((word) => !["of", "the", "and", "for"].includes(word)).map((word) => word[0]).join("");
    if (initials.length >= 2) tokens.add(initials);
    const joined = words.join("").replace(/&/g, "");
    if (joined.length >= 3) tokens.add(joined);
  }
  return [...tokens].some((token) => token.length >= 2 && labels.includes(token));
}

// ---------------------------------------------------------------------
// 3. OFFICIAL SITES (for sure matches whose overview results were not their own site)
// ---------------------------------------------------------------------

const siteAnswer = z.object({ sites: z.array(z.object({ ref: z.string(), result: z.number().int().nullable().default(null) })) });
export const webSiteAnswerSchema = siteAnswer;
export const webSiteAnswerJsonSchema = z.toJSONSchema(siteAnswer);

const SITE_PROMPT = `For each party, pick its OWN official website from the search results, or null.

Answer with JSON only: { "sites": [{ "ref": "E1", "result": 2 }] }, one item per party; result is a result number or null.
- The official website is the one the party itself runs: its corporate or organization home, or a government's own site for a government body.
- null for a role or job (people holding a job have no website of their own), for a country unless the result is that country's national government site, and whenever unsure.
- Never pick a site that only shares the name: tourism sites, directories, maps, encyclopedias, news, social media, job boards, a namesake on another domain ending.`;

export function buildWebSiteMessages(subjects: WebSubject[], summaries: Map<string, string>, results: Map<string, WebResult[]>): ChatMessage[] {
  const payload = subjects.map((subject, index) => ({
    ref: `E${index + 1}`, name: subject.name, kind: subject.kind, about: summaries.get(subject.entityId) ?? "",
    results: (results.get(subject.entityId) ?? []).map((result, r) => ({ number: r + 1, title: result.title, url: result.url, text: result.content.slice(0, 300) })),
  }));
  return [{ role: "system", content: SITE_PROMPT }, { role: "user", content: JSON.stringify({ parties: payload }) }];
}

// ANSWER -> each party's site: a picked result, on http(s), whose domain carries the party's name
export function readWebSites(answer: z.infer<typeof siteAnswer>, subjects: WebSubject[], results: Map<string, WebResult[]>): Map<string, string> {
  const byRef = new Map(subjects.map((subject, index) => [`E${index + 1}`, subject]));
  const sites = new Map<string, string>();
  for (const item of answer.sites) {
    const subject = byRef.get(item.ref.trim().toUpperCase());
    const result = subject && item.result !== null ? results.get(subject.entityId)?.[item.result - 1] : undefined;
    if (!subject || !result) continue;
    const site = officialSite(result.url, [result]);
    if (site && siteNamesParty(site, subject)) sites.set(subject.entityId, site);
  }
  return sites;
}
