import { it, expect, vi } from "vitest";
import { searchWebAndWikipedia } from "./webSearch";
import { fetchWithRetry } from "@/lib/processing/requests";
vi.mock("@/lib/processing/requests", () => ({ fetchWithRetry: vi.fn(), withRequestSlot: (_kind: string, _host: string, _credential: string, run: () => Promise<unknown>) => run() }));
vi.mock("@/lib/processing/metrics", () => ({ processingSpan: (_name: string, run: () => Promise<unknown>) => run() }));
it("checks Wikipedia even when web search successfully returns primary sources", async () => {
  vi.mocked(fetchWithRetry).mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "api.tavily.com") return Response.json({ results: [{ title: "Official source", url: "https://example.gov/info", content: "Reliable primary source text." }] });
    if (url.searchParams.get("list") === "search") return Response.json({ query: { search: [{ title: "Topic" }] } });
    return Response.json({ query: { pages: [{ title: "Topic", extract: "Wikipedia article text.", fullurl: "https://en.wikipedia.org/wiki/Topic" }] } });
  });
  const results = await searchWebAndWikipedia("test-key", "primary topic", "Topic");
  expect(results.map((result) => result.url)).toEqual(["https://example.gov/info", "https://en.wikipedia.org/wiki/Topic"]);
  expect(fetchWithRetry).toHaveBeenCalledTimes(3);
});
