import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PatchedText, patchDisplayParts } from "./PatchedText";

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => React.createElement("a", props, children) }));
let root: Root;
let container: HTMLElement;
let reduce = false;
beforeEach(() => {
  vi.useFakeTimers();
  const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.matchMedia = () => ({ matches: reduce, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
  container = window.document.getElementById("root")!;
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
  reduce = false;
});
const render = (text: string) => act(async () => root.render(React.createElement("p", null, React.createElement(PatchedText, { text }), React.createElement("sup", null, "[1]"))));

it("fades only removed words, eases replacement words in, and keeps the citation mounted", async () => {
  await render("Keep this. Inspect weekly. Keep that.");
  const citation = container.querySelector("sup");
  await render("Keep this. Inspect monthly. Keep that.");
  expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe("weekly.");
  expect(container.querySelector(".sr-only")?.textContent).toBe("monthly.");
  expect(container.querySelector("sup")).toBe(citation);
  await act(async () => vi.advanceTimersByTime(160));
  expect(container.textContent).toBe("Keep this. Inspect monthly. Keep that.[1]");
  expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  await act(async () => vi.advanceTimersByTime(480));
  expect(container.querySelector(".sr-only")).toBeNull();
});
it("uses the latest update when edits arrive during a fade", async () => {
  await render("Inspect weekly.");
  await render("Inspect monthly.");
  await render("Inspect daily.");
  await act(async () => vi.advanceTimersByTime(160));
  await act(async () => vi.advanceTimersByTime(480));
  expect(container.textContent).toBe("Inspect daily.[1]");
});
it("shows reduced-motion updates immediately", async () => {
  reduce = true;
  await render("Inspect weekly.");
  await render("Inspect daily.");
  expect(container.textContent).toBe("Inspect daily.[1]");
  expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
});
it("preserves exact whitespace and supports insertion, deletion, and oversized text", () => {
  for (const [before, after] of [[" A\nB ", " A\nnew B "], [" A\nB ", " A\n "], ["x ".repeat(2000), "x ".repeat(2000) + "new"]]) {
    const parts = patchDisplayParts(before!, after!);
    expect(parts.filter((part) => part.kind !== "added").map((part) => part.text).join("")).toBe(before);
    expect(parts.filter((part) => part.kind !== "removed").map((part) => part.text).join("")).toBe(after);
  }
});
