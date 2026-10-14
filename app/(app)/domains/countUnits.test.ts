import { describe, expect, it } from "vitest";
import type { Tables } from "@/lib/database/types";
import { buildDomainTree } from "@/lib/domains/tree";
import { subtreeCounts, unitsByDomain } from "./countUnits";

// SEED-LIKE TREE: Projects > Alpha > (Data layer, Planning)
const DOMAINS = [
  { id: "p", name: "Projects", parent_id: null, path: "Projects" },
  { id: "a", name: "Alpha", parent_id: "p", path: "Projects/Alpha" },
  { id: "d", name: "Data layer", parent_id: "a", path: "Projects/Alpha/Data layer" },
  { id: "l", name: "Planning", parent_id: "a", path: "Projects/Alpha/Planning" },
] as Tables<"domains">[];

describe("subtreeCounts", () => {
  it("counts current units in a branch once each", () => {
    const rows = [
      { unit_id: "u1", domain_id: "a" },
      { unit_id: "u2", domain_id: "l" },
      { unit_id: "u2", domain_id: "d" },
      { unit_id: "u3", domain_id: "d" },
    ];
    const direct = unitsByDomain(rows, (id) => id !== "u3");
    const counts = subtreeCounts(buildDomainTree(DOMAINS), direct);
    expect(Object.fromEntries(counts)).toEqual({ p: 2, a: 2, d: 1, l: 1 });
  });
});
