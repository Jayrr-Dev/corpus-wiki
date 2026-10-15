import { describe, expect, it } from "vitest";
import { contentWords, relatedLinks, scoreRelatedPairs, withRelated } from "./related";
import type { GraphData, GraphNode } from "./types";

// =====================================================================
// FIXTURE: safety claims. u1/u2 share words (inspections), u3/u4 share
// an entity and a nested domain, u5 shares nothing, and only the broad
// root domain "Topics" joins everything (which must not count).
// =====================================================================

function unit(id: string, text: string, extra: Partial<GraphNode> = {}): GraphNode {
  return {
    id, kind: "unit", label: id, text, href: `/units/${id}`, createdAt: "2026-10-01T00:00:00Z", degree: 0,
    domainPaths: ["Topics"], entityNames: [], unitKind: "fact", status: "established", ...extra,
  };
}

const nodes: GraphNode[] = [
  unit("u1", "Supervisors conduct documented workplace inspections weekly on project sites"),
  unit("u2", "Workplace inspections are documented and reviewed by the safety committee"),
  unit("u3", "Hearing conservation testing happens yearly", { entityNames: ["Utilitek"], domainPaths: ["Topics/Health & Safety/PPE"] }),
  unit("u4", "Earplugs are issued at orientation", { entityNames: ["Utilitek"], domainPaths: ["Topics/Health & Safety"] }),
  unit("u5", "Lunch is served at noon in the cafeteria"),
  unit("u6", "Committee members rotate quarterly"),
  { ...unit("e1", "Utilitek"), kind: "entity" },
];
const data: GraphData = { nodes, links: [] };
const pairKeys = (links: { source: string; target: string }[]) => links.map((link) => `${link.source}-${link.target}`).sort();

describe("contentWords", () => {
  it("drops stopwords and short words and folds plurals", () => {
    expect(contentWords("All employees attend the weekly inspections, as required")).toEqual(["attend", "weekly", "inspection", "required"]);
  });
});

describe("scoreRelatedPairs", () => {
  const pairs = scoreRelatedPairs(nodes);

  it("scores shared words, shared entities and nested domains, units only", () => {
    const keys = pairs.map((pair) => `${pair.source}-${pair.target}`);
    expect(keys).toContain("u1-u2");
    expect(keys).toContain("u3-u4");
    expect(keys.some((key) => key.includes("e1"))).toBe(false);
  });

  it("ignores a shared root domain on its own", () => {
    expect(pairs.some((pair) => pair.source === "u5" || pair.target === "u5")).toBe(false);
  });

  it("returns scores strongest first, within 0..1", () => {
    expect(pairs.every((pair, i) => pair.score > 0 && pair.score <= 1 && (i === 0 || pairs[i - 1]!.score >= pair.score))).toBe(true);
  });
});

describe("relatedLinks", () => {
  const pairs = scoreRelatedPairs(nodes);

  it("keeps pairs at or above the threshold as similar links", () => {
    const links = relatedLinks(data, pairs, { threshold: 0.2 });
    expect(pairKeys(links)).toEqual(expect.arrayContaining(["u1-u2", "u3-u4"]));
    expect(links.every((link) => link.kind === "similar")).toBe(true);
    expect(relatedLinks(data, pairs, { threshold: 1.01 })).toEqual([]);
  });

  it("skips pairs a stored link already joins", () => {
    const linked: GraphData = { nodes, links: [{ id: "l1", source: "u2", target: "u1", kind: "supports" }] };
    expect(pairKeys(relatedLinks(linked, pairs, { threshold: 0 }))).not.toContain("u1-u2");
  });

  it("gives each unit its own strongest links, skipping pairs where both are full", () => {
    const many = [unit("a", "x"), unit("b", "x"), unit("c", "x"), unit("d", "x")];
    const all = [
      { source: "a", target: "b", score: 0.9 },
      { source: "a", target: "c", score: 0.8 },
      { source: "b", target: "c", score: 0.7 },
      { source: "a", target: "d", score: 0.6 },
    ];
    // a-c is c's best and a-d is d's best, so both go in; b-c is skipped (b and c already have theirs)
    expect(pairKeys(relatedLinks({ nodes: many, links: [] }, all, { threshold: 0, perNode: 1 }))).toEqual(["a-b", "a-c", "a-d"]);
  });
});

describe("withRelated", () => {
  it("adds nothing when switched off", () => {
    expect(withRelated(data, { show: false, threshold: 0 })).toBe(data);
  });

  it("adds similar links when on", () => {
    expect(withRelated(data, { show: true, threshold: 0.2 }).links.length).toBeGreaterThan(0);
  });
});
