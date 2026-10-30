import { describe, expect, it } from "vitest";
import { publicGraphData } from "./publicGraph";
import type { PublicGraph } from "./types";

const snapshot: PublicGraph = {
  pages: [
    { id: "p1", slug: "first page", title: "First", domains: ["Safety"] },
    { id: "p2", slug: "second", title: "Second", domains: [] },
  ],
  claims: [
    { id: "c1", label: "Claim one", domains: ["Safety/Training"], pages: [
      { page: "p1", section: "Intro", position: 0 },
      { page: "p2", section: "More", position: 2 },
    ] },
    { id: "c2", label: "Claim two", domains: [], pages: [{ page: "p2", section: "More", position: 2 }] },
  ],
  links: [
    { id: "l1", source: "c1", target: "c2", kind: "supports" },
    { id: "l2", source: "c1", target: "gone", kind: "supports" },
  ],
};

describe("publicGraphData", () => {
  const graph = publicGraphData(snapshot, "/s/abc", "2026-10-30T00:00:00.000Z");
  const node = (id: string) => graph.nodes.find(item => item.id === id)!;

  it("opens every dot on a published article", () => {
    expect(node("p1").href).toBe("/s/abc/wiki/first%20page");
    expect(node("c1").href).toBe("/s/abc/wiki/first%20page");
    expect(node("c2").href).toBe("/s/abc/wiki/second");
  });

  it("links claims to their pages, drops broken links and counts degrees", () => {
    expect(graph.links.map(link => link.id).sort()).toEqual(["cites:p1:c1", "cites:p2:c1", "cites:p2:c2", "l1"]);
    expect(node("c1").degree).toBe(3);
    expect(node("p2").degree).toBe(2);
  });

  it("keeps the article and section grouping for each claim", () => {
    expect(node("c1").pageTitles).toEqual(["First", "Second"]);
    expect(node("c1").pageSections).toEqual([
      { page: "First", section: "Intro", position: 0 },
      { page: "Second", section: "More", position: 2 },
    ]);
  });

  it("leaves out a claim with no published page", () => {
    const orphaned = publicGraphData({ ...snapshot, claims: [{ id: "c9", label: "Lost", domains: [], pages: [{ page: "nope", section: "", position: 0 }] }] }, "/s/abc", "2026-10-30T00:00:00.000Z");
    expect(orphaned.nodes.map(item => item.id)).toEqual(["p1", "p2"]);
    expect(orphaned.links).toEqual([]);
  });
});
