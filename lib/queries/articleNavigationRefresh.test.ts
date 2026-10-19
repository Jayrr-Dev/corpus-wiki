import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useArticleTopicLinks } from "./articleTopicLinks";
import { useRelatedArticles } from "./relatedArticles";

const reads = vi.hoisted(() => ({ links: vi.fn(), related: vi.fn() }));
vi.mock("@/lib/server-actions/articleTopicLinks", () => ({ readArticleTopicLinks: reads.links }));
vi.mock("@/lib/server-actions/relatedArticles", () => ({ readRelatedArticles: reads.related }));

let root: Root;
let container: HTMLElement;
let client: QueryClient;
beforeEach(() => {
  const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = window.document.getElementById("root")!;
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it.each(["links", "related"] as const)("keeps %s during context refreshes without leaking another article's destinations", async (kind) => {
  const useNavigation = kind === "links" ? useArticleTopicLinks : useRelatedArticles;
  const result = (label: string) => ({ ok: true, links: [{ label, href: `/p/${label}` }], articles: [{ id: label, title: label, slug: label }] });
  let finishRefresh!: (value: ReturnType<typeof result>) => void;
  let finishNavigation!: (value: ReturnType<typeof result>) => void;
  reads[kind].mockResolvedValueOnce(result("original"))
    .mockImplementationOnce(() => new Promise((resolve) => { finishRefresh = resolve; }))
    .mockImplementationOnce(() => new Promise((resolve) => { finishNavigation = resolve; }));
  function View({ pageId, context }: { pageId: string; context: string }) {
    const query = useNavigation(pageId, context);
    return React.createElement("output", null, JSON.stringify(query.data ?? []));
  }
  const render = (pageId: string, context: string) => act(async () => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(View, { pageId, context })));
  });
  const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });

  await render("one", "initial");
  await flush();
  expect(container.textContent).toContain("original");
  await render("one", "refreshed");
  expect(container.textContent).toContain("original");
  await act(async () => finishRefresh(result("updated")));
  await flush();
  expect(container.textContent).toContain("updated");
  await render("two", "refreshed");
  expect(container.textContent).toBe("[]");
  await act(async () => finishNavigation(result("second-article")));
  await flush();
  expect(container.textContent).toContain("second-article");
});

it.each(["links", "related"] as const)("caches %s across time and article revisits, then recalculates after a knowledge change", async (kind) => {
  vi.useFakeTimers();
  const useNavigation = kind === "links" ? useArticleTopicLinks : useRelatedArticles;
  reads[kind].mockResolvedValue({ ok: true, links: [{ label: "cached", href: "/p/cached" }], articles: [{ id: "cached", title: "cached", slug: "cached" }] });
  function View({ ready }: { ready: boolean }) {
    const query = useNavigation("one", "unchanged-content", ready);
    return React.createElement("output", null, JSON.stringify(query.data ?? []));
  }
  const render = (ready: boolean) => act(async () => {
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(View, { ready })));
    await vi.advanceTimersByTimeAsync(10);
  });
  await render(false);
  expect(reads[kind]).not.toHaveBeenCalled();
  await render(true);
  expect(reads[kind]).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(5 * 60_000));
  expect(reads[kind]).toHaveBeenCalledTimes(1);
  await act(async () => root.render(null));
  await render(true);
  expect(container.textContent).toContain("cached");
  expect(reads[kind]).toHaveBeenCalledTimes(1);

  await act(async () => {
    await client.invalidateQueries({ queryKey: ["table", "lines"] });
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(reads[kind]).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain("cached");
});
