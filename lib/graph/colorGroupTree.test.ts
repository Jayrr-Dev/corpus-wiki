import { describe, expect, it } from "vitest";
import { colorGroupTree } from "./colorGroupTree";
import type { GraphGroup } from "./groups";
import { DEFAULT_GRAPH_SETTINGS, parseSavedSettings, withDomainColorGroups } from "./settings";
import type { GraphNode } from "./types";

const groups: GraphGroup[] = [
  { id: "leaf", query: "domain:Company/Safety/WHMIS", color: "graph-teal" },
  { id: "child", query: "domain:Company/Safety", color: "failed" },
  { id: "root", query: "domain:Company", color: "link" },
  { id: "other", query: "domain:Quality", color: "applied" },
];

describe("collapsible color hierarchy", () => {
  it("starts collapsed and expands each level independently without reordering color rules", () => {
    expect(colorGroupTree(groups, new Set(), "").map((row) => row.group.id)).toEqual(["root", "other"]);
    expect(colorGroupTree(groups, new Set(["root"]), "").map((row) => row.group.id)).toEqual(["root", "child", "other"]);
    expect(colorGroupTree(groups, new Set(["root", "child"]), "").map((row) => row.depth)).toEqual([0, 1, 2, 0]);
    expect(colorGroupTree(groups, new Set(["child"]), "").map((row) => row.group.id)).toEqual(["root", "other"]);
    expect(groups[0]!.id).toBe("leaf");
  });

  it("search reveals a match and its ancestors, then restores the collapsed view", () => {
    const expanded = new Set<string>();
    expect(colorGroupTree(groups, expanded, "whmis").map((row) => row.group.id)).toEqual(["root", "child", "leaf"]);
    expect(colorGroupTree(groups, expanded, "absent")).toEqual([]);
    expect(colorGroupTree(groups, expanded, "")).toHaveLength(2);
  });

  it("attaches children to the closest remaining parent and preserves custom rules", () => {
    const custom: GraphGroup = { id: "custom", query: "kind:decision", color: "graph-pink" };
    const rows = colorGroupTree([...groups.filter((group) => group.id !== "child"), custom], new Set(["root"]), "");
    expect(rows.find((row) => row.group.id === "leaf")!.depth).toBe(1);
    expect(rows.find((row) => row.group.id === "custom")!.depth).toBe(0);
  });

  it("persists the expanded palette and uses it for new automatic groups", () => {
    expect(parseSavedSettings({ ...DEFAULT_GRAPH_SETTINGS, groups }).groups).toEqual(groups);
    const nodes = Array.from({ length: 10 }, (_, i) => ({ domainPaths: ["Domain " + i] })) as GraphNode[];
    const settings = withDomainColorGroups(DEFAULT_GRAPH_SETTINGS, nodes);
    expect(new Set(settings.groups.map((group) => group.color)).size).toBe(10);
  });
});
