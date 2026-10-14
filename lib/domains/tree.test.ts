import { describe, expect, it } from "vitest";
import type { Tables } from "@/lib/database/types";
import { buildDomainTree } from "./tree";

// FIXTURE BUILDER: a domain row with only the fields the tree uses varying
function domain(id: string, name: string, parent_id: string | null): Tables<"domains"> {
  return { id, name, parent_id, path: name, created_at: "", proposed_by: "ai" };
}

describe("buildDomainTree", () => {
  it("nests children under parents and sorts by name", () => {
    const tree = buildDomainTree([
      domain("p", "Projects", null),
      domain("a", "Alpha", "p"),
      domain("t", "Topics", null),
      domain("d", "Data layer", "a"),
    ]);
    expect(tree.map((n) => n.name)).toEqual(["Projects", "Topics"]);
    expect(tree[0]?.children[0]?.children[0]?.name).toBe("Data layer");
  });

  it("keeps orphans as roots", () => {
    const tree = buildDomainTree([domain("x", "Orphan", "missing")]);
    expect(tree).toHaveLength(1);
  });
});
