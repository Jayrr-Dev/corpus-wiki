import "server-only";

// =====================================================================
// WEB SEARCH: where external knowledge comes from. Tavily searches the
// web and returns each page's text as markdown, so a result can be stored
// and reconciled like an uploaded file. Needs TAVILY_API_KEY.
// =====================================================================

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
// A page longer than this is cut, so one result cannot swamp the reconciler
const MAX_PAGE_CHARS = 40_000;

export type WebPage = { title: string; url: string; text: string; publishedDate: string | null };

type TavilyResponse = { results?: { title?: string; url?: string; content?: string; raw_content?: string | null; published_date?: string }[] };

// The key, or null when web search is not set up
export function webSearchKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.TAVILY_API_KEY?.trim() || null;
}

// The top pages for a query, each with its full text (or Tavily's summary when the page text is missing)
export async function searchWeb(apiKey: string, query: string, maxResults = 3): Promise<WebPage[]> {
  const response = await fetch(TAVILY_SEARCH_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, max_results: maxResults, search_depth: "advanced", include_raw_content: "markdown" }),
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
