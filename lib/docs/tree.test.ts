import { describe, expect, it } from "vitest";
import type { Tables } from "@/lib/database/types";
import { docsTree } from "./tree";
import type { DocSetSummary } from "./types";

function domain(id: string, name: string, parent_id: string | null, retired = false): Tables<"domains"> {
  return { id, name, parent_id, path: name, created_at: "", proposed_by: "ai", retired_at: retired ? "2026-01-01" : null };
}

function set(id: string, scopeId: string | null, extra: Partial<DocSetSummary> = {}): DocSetSummary {
  return {
    id, title: id, scopeKind: "topic", scopeId, coverage: 100, status: "ready", error: null,
    createdAt: "", updatedAt: "", pageCount: 3, stalePages: 0, ...extra,
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

describe("docsTree", () => {
  it("keeps only branches that hold a set, counting sets over the branch", () => {
    const { roots, other } = docsTree(DOMAINS, [set("a", "atm"), set("b", "cse"), set("c", "cse")]);
    expect(other).toEqual([]);
    expect(roots.map((root) => [root.name, root.count])).toEqual([["Brightwater", 3]]);
    const hs = roots[0]!.children;
    expect(hs.map((node) => node.name)).toEqual(["Health & Safety"]);
    const cse = hs[0]!.children[0]!;
    expect(cse.sets.map((s) => s.id)).toEqual(["b", "c"]);
    expect(cse.children.map((node) => [node.name, node.count])).toEqual([["Atmosphere Testing", 1]]);
  });

  it("puts other sources and sets on retired topics apart", () => {
    const { roots, other } = docsTree(DOMAINS, [set("g", null, { scopeKind: "glossary" }), set("r", "old")]);
    expect(roots).toEqual([]);
    expect(other.map((s) => s.id)).toEqual(["g", "r"]);
  });
});
