import "server-only";

// =====================================================================
// WEB SEARCH: where external knowledge comes from. Tavily searches the
// web and returns each page's text as markdown, so a result can be stored
// and reconciled like an uploaded file. Tavily needs TAVILY_API_KEY; when
// it is not set, fails, or finds nothing, Wikipedia (free, no key) is
// searched instead.
// =====================================================================

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const WIKIPEDIA_API_URL = "https://en.wikipedia.org/w/api.php";
// Wikipedia asks API callers to name themselves
const WIKIPEDIA_USER_AGENT = "SecondBrainEngine/0.1 (external knowledge search)";
// A page longer than this is cut: each page is reconciled like an uploaded file, so length is time
const MAX_PAGE_CHARS = 8_000;
// Pages kept per search; each is ingested in full, so a few good ones beat many
const MAX_RESULTS = 2;

export type WebPage = { title: string; url: string; text: string; publishedDate: string | null };

type TavilyResponse = { results?: { title?: string; url?: string; content?: string; raw_content?: string | null; published_date?: string }[] };
type WikipediaSearchResponse = { query?: { search?: { title: string }[] } };
type WikipediaExtractResponse = { query?: { pages?: { title?: string; extract?: string; fullurl?: string; touched?: string; missing?: boolean }[] } };

// The Tavily key, or null when only Wikipedia is available
export function webSearchKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.TAVILY_API_KEY?.trim() || null;
}

// The top pages for a query: Tavily when it has a key and finds something, otherwise Wikipedia
export async function searchWeb(apiKey: string | null, query: string, maxResults = MAX_RESULTS): Promise<WebPage[]> {
  if (apiKey) {
    try {
      const pages = await searchTavily(apiKey, query, maxResults);
      if (pages.length) return pages;
    } catch (error) {
      console.warn("Tavily search failed, using Wikipedia:", error instanceof Error ? error.message : error);
    }
  }
  return searchWikipedia(query, maxResults);
}

// Each page with its full text (or Tavily's summary when the page text is missing)
async function searchTavily(apiKey: string, query: string, maxResults: number): Promise<WebPage[]> {
  const response = await fetch(TAVILY_SEARCH_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, max_results: maxResults, search_depth: "basic", include_raw_content: "markdown" }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Web search failed (Tavily ${response.status}): ${(await response.text()).slice(0, 300)}`);
  const body = (await response.json()) as TavilyResponse;
  return (body.results ?? []).flatMap((result) => {
    const text = (result.raw_content || result.content || "").trim();
    if (!result.url || !text) return [];
    return [{ title: result.title?.trim() || result.url, url: result.url, text: text.slice(0, MAX_PAGE_CHARS), publishedDate: result.published_date ?? null }];
  });
}

// The best-matching English Wikipedia articles, as plain text
async function searchWikipedia(query: string, maxResults: number): Promise<WebPage[]> {
  const search = await wikipedia<WikipediaSearchResponse>({ list: "search", srsearch: query, srlimit: String(maxResults) });
  const pages: WebPage[] = [];
  for (const { title } of search.query?.search ?? []) {
    // Full extracts come one page per request
    const body = await wikipedia<WikipediaExtractResponse>({ prop: "extracts|info", explaintext: "1", inprop: "url", titles: title });
    const page = body.query?.pages?.[0];
    const text = page?.extract?.trim();
    if (!page || page.missing || !text || !page.fullurl) continue;
    pages.push({ title: page.title ?? title, url: page.fullurl, text: text.slice(0, MAX_PAGE_CHARS), publishedDate: page.touched ?? null });
  }
  return pages;
}

async function wikipedia<T>(params: Record<string, string>): Promise<T> {
  const url = `${WIKIPEDIA_API_URL}?${new URLSearchParams({ action: "query", format: "json", formatversion: "2", ...params })}`;
  const response = await fetch(url, { headers: { "User-Agent": WIKIPEDIA_USER_AGENT }, cache: "no-store" });
  if (!response.ok) throw new Error(`Web search failed (Wikipedia ${response.status}).`);
  return (await response.json()) as T;
}

// SNIPPETS: short text per result (no full pages), for checking who a result is about.
// Tavily when it has a key and finds something, otherwise Wikipedia extracts cut short.
const SNIPPET_CHARS = 1_200;
export type WebSnippet = { title: string; url: string; content: string };

export async function searchSnippets(apiKey: string | null, query: string, maxResults = 5): Promise<WebSnippet[]> {
  if (apiKey) {
    try {
      const response = await fetch(TAVILY_SEARCH_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query, max_results: maxResults, search_depth: "basic" }),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`Tavily ${response.status}`);
      const body = (await response.json()) as TavilyResponse;
      const results = (body.results ?? []).flatMap((result) => result.url && result.content?.trim()
        ? [{ title: result.title?.trim() || result.url, url: result.url, content: result.content.trim().slice(0, SNIPPET_CHARS) }] : []);
      if (results.length) return results;
    } catch (error) {
      console.warn("Tavily snippet search failed, using Wikipedia:", error instanceof Error ? error.message : error);
    }
  }
  return (await searchWikipedia(query, Math.min(maxResults, 2))).map((page) => ({ title: page.title, url: page.url, content: page.text.slice(0, SNIPPET_CHARS) }));
}

// OFFICIAL WEBSITE FROM WIKIPEDIA: the page's Wikidata item, its "official website" (P856).
// Precise when the page is already known to be about the party; null when there is none.
type PagePropsResponse = { query?: { pages?: { pageprops?: { wikibase_item?: string } }[] } };
type WikidataClaims = { claims?: { P856?: { rank?: string; mainsnak?: { datavalue?: { value?: string } } }[] } };

export async function wikipediaOfficialSite(pageUrl: string): Promise<string | null> {
  let url: URL;
  try { url = new URL(pageUrl); } catch { return null; }
  if (!/(^|\.)wikipedia\.org$/.test(url.hostname) || !url.pathname.startsWith("/wiki/")) return null;
  const title = decodeURIComponent(url.pathname.slice("/wiki/".length));
  const props = await wikipedia<PagePropsResponse>({ prop: "pageprops", ppprop: "wikibase_item", titles: title, redirects: "1" });
  const item = props.query?.pages?.[0]?.pageprops?.wikibase_item;
  if (!item || !/^Q\d+$/.test(item)) return null;
  const response = await fetch(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: "wbgetclaims", entity: item, property: "P856", format: "json" })}`, { headers: { "User-Agent": WIKIPEDIA_USER_AGENT }, cache: "no-store" });
  if (!response.ok) return null;
  const claims = ((await response.json()) as WikidataClaims).claims?.P856 ?? [];
  const preferred = claims.find((claim) => claim.rank === "preferred") ?? claims.find((claim) => claim.rank !== "deprecated");
  return preferred?.mainsnak?.datavalue?.value ?? null;
}

// ONE PAGE'S TEXT (for storing it as an external source): Wikipedia's plain-text extract for a
// Wikipedia article, otherwise Tavily's extract (needs the key). Cut like a search page; null when unreadable.
const TAVILY_EXTRACT_URL = "https://api.tavily.com/extract";
type TavilyExtractResponse = { results?: { url?: string; raw_content?: string | null }[] };

export async function readWebPage(apiKey: string | null, pageUrl: string): Promise<string | null> {
  let url: URL;
  try { url = new URL(pageUrl); } catch { return null; }
  if (/(^|\.)wikipedia\.org$/.test(url.hostname) && url.pathname.startsWith("/wiki/")) {
    const body = await wikipedia<WikipediaExtractResponse>({ prop: "extracts", explaintext: "1", titles: decodeURIComponent(url.pathname.slice("/wiki/".length)), redirects: "1" });
    const text = body.query?.pages?.[0]?.extract?.trim();
    return text ? text.slice(0, MAX_PAGE_CHARS) : null;
  }
  if (!apiKey) return null;
  const response = await fetch(TAVILY_EXTRACT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ urls: [pageUrl], format: "markdown" }),
    cache: "no-store",
  });
  if (!response.ok) return null;
  const text = ((await response.json()) as TavilyExtractResponse).results?.[0]?.raw_content?.trim();
  return text ? text.slice(0, MAX_PAGE_CHARS) : null;
}
