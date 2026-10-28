import "server-only";

import type { WebProfile } from "@/lib/ai/tokenFactory/entityWeb";
import type { AdminSupabase } from "@/lib/supabase/admin";
import { uploadExecution } from "@/lib/ingest/workflowContext";
import { wikidata, wikipediaItem } from "./webSearch";

// =====================================================================
// SIZES FROM WIKIDATA: employees, revenue, total assets, budget and
// population for a stakeholder the web lookup already matched for sure,
// added to its web facts (entity_profiles.web) with Wikidata as the
// source. The Power Level reads them from there (docs/power-model.md).
// The item comes from the confirmed Wikipedia page, else a name search
// whose official website is the card's own; never from a name alone.
// =====================================================================

type Snak = { datavalue?: { value?: unknown } };
type Claim = { rank?: string; mainsnak?: Snak; qualifiers?: Record<string, Snak[]> };
export type Claims = Record<string, Claim[] | undefined>;
type EntitiesResponse = { entities?: Record<string, { claims?: Claims }> };
type SearchResponse = { search?: { id?: string }[] };
type Fact = WebProfile["facts"][number];

export const WIKIDATA_SOURCE_TITLE = "Wikidata";

// Wikidata properties, and the fact label the power score reads them under
const SIZE_PROPERTIES = [
  { property: "P1128", label: "Employees", money: false },
  { property: "P2139", label: "Revenue", money: true },
  { property: "P2403", label: "Total assets", money: true },
  { property: "P2769", label: "Budget", money: true },
  { property: "P1082", label: "Population", money: false },
] as const;

// Rough US dollars per unit, by currency item; money in other currencies is left out
const USD_PER: Record<string, number> = {
  Q4917: 1, Q1104069: 0.73, Q4916: 1.08, Q25224: 1.27, Q259502: 0.66, Q25344: 1.13,
  Q8146: 0.0067, Q39099: 0.14, Q80524: 0.012, Q202040: 0.00073,
};

const yearOf = (claim: Claim) => {
  const time = (claim.qualifiers?.P585?.[0]?.datavalue?.value as { time?: string } | undefined)?.time;
  const year = /^[+-]?(\d{4})/.exec(time ?? "")?.[1];
  return year ? Number(year) : null;
};

// The claim to trust: preferred rank first, then the newest "point in time", never deprecated
function bestClaim(claims: Claim[] | undefined): Claim | null {
  const usable = (claims ?? []).filter((claim) => claim.rank !== "deprecated" && claim.mainsnak?.datavalue);
  const preferred = usable.filter((claim) => claim.rank === "preferred");
  const pool = preferred.length ? preferred : usable;
  return [...pool].sort((a, b) => (yearOf(b) ?? 0) - (yearOf(a) ?? 0))[0] ?? null;
}

const rounded = (value: number) => Number(value.toPrecision(3)).toLocaleString("en-US");
function amountText(value: number): string {
  if (value >= 1e12) return `${rounded(value / 1e12)} trillion`;
  if (value >= 1e9) return `${rounded(value / 1e9)} billion`;
  if (value >= 1e6) return `${rounded(value / 1e6)} million`;
  return rounded(value);
}

// SIZE FACTS from an item's claims: "Employees: 12,000 (2023)", "Revenue: US$77.8 billion (2023)"
export function sizeFactsFromClaims(claims: Claims): { label: string; value: string }[] {
  return SIZE_PROPERTIES.flatMap(({ property, label, money }) => {
    const claim = bestClaim(claims[property]);
    const quantity = claim?.mainsnak?.datavalue?.value as { amount?: string; unit?: string } | undefined;
    let amount = Number(quantity?.amount);
    if (!Number.isFinite(amount) || amount <= 0) return [];
    if (money) {
      const rate = USD_PER[quantity?.unit?.split("/").pop() ?? ""];
      if (rate === undefined) return [];
      amount *= rate;
    }
    const year = claim ? yearOf(claim) : null;
    return [{ label, value: `${money ? "US$" : ""}${amountText(amount)}${year ? ` (${year})` : ""}` }];
  });
}

const hostOf = (url: string) => { try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; } };
const websitesOf = (claims: Claims | undefined) => (claims?.P856 ?? []).map((claim) => claim.mainsnak?.datavalue?.value).filter((value): value is string => typeof value === "string");

async function claimsOf(ids: string[]): Promise<Record<string, Claims>> {
  if (!ids.length) return {};
  const body = await wikidata<EntitiesResponse>({ action: "wbgetentities", ids: ids.join("|"), props: "claims" });
  return Object.fromEntries(Object.entries(body.entities ?? {}).map(([id, entity]) => [id, entity.claims ?? {}]));
}

// THE ITEM a confirmed profile is about, with its claims: the confirmed Wikipedia page's item, else
// the one a name search finds whose official website is the profile's own; null when unsure
async function itemFor(name: string, profile: WebProfile): Promise<{ id: string; claims: Claims } | null> {
  const page = profile.sources.find((source) => /wikipedia\.org\/wiki\//.test(source.url));
  const fromPage = page ? await wikipediaItem(page.url) : null;
  if (fromPage) {
    const claims = (await claimsOf([fromPage]))[fromPage];
    return claims ? { id: fromPage, claims } : null;
  }
  const site = profile.website ? hostOf(profile.website) : null;
  if (!site) return null;
  const found = await wikidata<SearchResponse>({ action: "wbsearchentities", search: name, language: "en", type: "item", limit: "7" });
  const ids = (found.search ?? []).map((hit) => hit.id).filter((id): id is string => !!id && /^Q\d+$/.test(id));
  const all = await claimsOf(ids);
  const matches = ids.filter((id) => websitesOf(all[id]).some((url) => hostOf(url) === site));
  return matches.length === 1 ? { id: matches[0]!, claims: all[matches[0]!]! } : null;
}

// A PROFILE WITH WIKIDATA SIZES: earlier Wikidata facts and source replaced; unchanged when no
// sure item or no sizes. Network failures leave the profile as it was.
export async function withWikidataSizes(name: string, profile: WebProfile): Promise<WebProfile> {
  let item: Awaited<ReturnType<typeof itemFor>>;
  try { item = await itemFor(name, profile); }
  catch { uploadExecution.getStore()?.signal?.throwIfAborted(); return profile; }
  const facts = item ? sizeFactsFromClaims(item.claims) : [];
  if (!item || !facts.length) return profile;
  const oldIndex = profile.sources.findIndex((source) => source.title === WIKIDATA_SOURCE_TITLE);
  const sources = profile.sources.filter((_, index) => index !== oldIndex);
  const reindex = (fact: Fact): Fact => ({ ...fact, sourceIndex: fact.sourceIndex === null || oldIndex < 0 || fact.sourceIndex < oldIndex ? fact.sourceIndex : fact.sourceIndex - 1 });
  const kept = profile.facts.filter((fact) => oldIndex < 0 || fact.sourceIndex !== oldIndex).map(reindex);
  const sourceIndex = sources.length;
  return {
    ...profile,
    facts: [...kept, ...facts.map((fact) => ({ ...fact, sourceIndex }))],
    sources: [...sources, { title: WIKIDATA_SOURCE_TITLE, url: `https://www.wikidata.org/wiki/${item.id}` }],
  };
}

// EXISTING CARDS: add Wikidata sizes to every stakeholder with a confirmed web profile (or these),
// one at a time with a pause, since Wikidata turns away fast bursts ("too many requests")
export async function addWikidataSizes(client: AdminSupabase, entityIds: string[] | null = null, pauseMs = 1500): Promise<{ checked: number; updated: number }> {
  let query = client.from("entity_profiles").select("entity_id, web, entities(name)").eq("is_stakeholder", true).not("web", "is", null);
  if (entityIds) query = query.in("entity_id", entityIds);
  const { data, error } = await query;
  if (error) throw error;
  let updated = 0;
  const rows = data as unknown as { entity_id: string; web: WebProfile; entities: { name: string } | null }[];
  for (const row of rows) {
    if (!row.entities) continue;
    await new Promise((done) => setTimeout(done, pauseMs));
    const next = await withWikidataSizes(row.entities.name, row.web);
    if (next === row.web) continue;
    const { error: saveError } = await client.from("entity_profiles").update({ web: next, updated_at: new Date().toISOString() }).eq("entity_id", row.entity_id);
    if (saveError) throw saveError;
    updated += 1;
  }
  return { checked: rows.length, updated };
}
