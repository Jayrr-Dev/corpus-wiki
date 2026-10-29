import { describe, expect, it } from "vitest";
import type { Tables } from "@/lib/database/types";
import type { SetSummary } from "./session";
import { filterStudyTree, practicedPct, studyTree } from "./tree";

function domain(id: string, name: string, parent_id: string | null, retired = false): Tables<"domains"> {
  return { id, name, parent_id, path: name, created_at: "", proposed_by: "ai", retired_at: retired ? "2026-01-01" : null };
}

function set(id: string, scopeId: string | null, extra: Partial<SetSummary> = {}): SetSummary {
  return {
    id, title: id, scopeKind: "topic", scopeId, coverage: 100, custom: false, types: ["flashcard"], introVideo: false, createdAt: "",
    items: 4, claims: 4, practiced: 2, practicedPct: 50, due: 1, stale: 0, levels: { new: 2, familiar: 2, known: 0, learned: 0 }, ...extra,
  };
}

const DOMAINS = [
  domain("org", "Brightwater", null),
  domain("hs", "Health & Safety", "org"),
  domain("cse", "Confined Space Entry", "hs"),
  domain("atm", "Atmosphere Testing", "cse"),
  domain("fire", "Fire Safety", "hs"),
  domain("old", "Old topic", "org", true),
];

describe("studyTree", () => {
  it("keeps only branches that hold a set, with totals over the branch", () => {
    const { roots, other } = studyTree(DOMAINS, [set("a", "atm"), set("b", "cse", { due: 3 })]);
    expect(other).toEqual([]);
    expect(roots.map((root) => root.name)).toEqual(["Brightwater"]);
    const hs = roots[0]!.children;
    expect(hs.map((node) => node.name)).toEqual(["Health & Safety"]);
    const cse = hs[0]!.children[0]!;
    expect(cse.sets.map((s) => s.id)).toEqual(["b"]);
    expect(cse.children[0]!.depth).toBe(3);
    expect(roots[0]!.totals).toEqual({ sets: 2, claims: 8, practiced: 4, due: 4 });
    expect(practicedPct(roots[0]!.totals)).toBe(50);
  });

  it("puts other sources and sets on retired topics apart", () => {
    const { roots, other } = studyTree(DOMAINS, [set("g", null, { scopeKind: "glossary" }), set("r", "old")]);
    expect(roots).toEqual([]);
    expect(other.map((s) => s.id)).toEqual(["g", "r"]);
  });
});

describe("filterStudyTree", () => {
  const { roots } = studyTree(DOMAINS, [set("a", "atm"), set("f", "fire")]);

  it("keeps a matching topic's branch and its parents as the path", () => {
    const [org] = filterStudyTree(roots, "atmos");
    const hs = org!.children[0]!;
    expect(hs.children.map((node) => node.name)).toEqual(["Confined Space Entry"]);
  });

  it("returns everything for an empty query and nothing for no match", () => {
    expect(filterStudyTree(roots, " ")).toHaveLength(1);
    expect(filterStudyTree(roots, "zzz")).toEqual([]);
  });
});
