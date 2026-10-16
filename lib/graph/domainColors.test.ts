import { describe, expect, it } from "vitest";
import { chooseDomainColor } from "./domainColors";
import { DEFAULT_GRAPH_SETTINGS, parseSavedSettings, withDomainColorGroups } from "./settings";
import type { GraphNode } from "./types";

describe("thematic domain colors", () => {
  it("uses recognizable themes for the domain itself, including nested topics", () => {
    expect(chooseDomainColor("Health & Safety", [])).toBe("applied");
    expect(chooseDomainColor("Quality Management", [])).toBe("link");
    expect(chooseDomainColor("Training", [])).toBe("graph-violet");
    expect(chooseDomainColor("Utilitek Solutions/Health & Safety", [])).toBe("applied");
    expect(chooseDomainColor("Communications", [])).toBe("graph-teal");
  });

  it("keeps related branches in a family and avoids duplicate assignments", () => {
    const paths = ["Health & Safety/Equipment", "Health & Safety/Reporting", "Quality Management", "Training", "Utilitek Solutions/Health & Safety/Communications", "Utilitek Solutions/Health & Safety/Discipline"];
    const nodes = paths.map((path) => ({ domainPaths: [path] })) as GraphNode[];
    const settings = withDomainColorGroups(DEFAULT_GRAPH_SETTINGS, nodes);
    expect(new Set(settings.groups.map(({ color }) => color)).size).toBe(settings.groups.length);
    const parent = { id: "safety", query: "domain:Health & Safety", color: "applied" as const };
    expect(chooseDomainColor("Health & Safety/Reporting", [parent])).toBe("applied-light");
  });

  it("migrates old automatic colors once and preserves subsequent edits and custom rules", () => {
    const old = { ...DEFAULT_GRAPH_SETTINGS, colorThemeVersion: undefined, groups: [
      { id: "domain:training", query: "domain:Training", color: "failed" },
      { id: "custom", query: "kind:decision", color: "graph-pink" },
    ] };
    const updated = parseSavedSettings(old);
    expect(updated.groups[0]!.color).toBe("graph-violet");
    expect(updated.groups[1]).toEqual(old.groups[1]);
    updated.groups[0]!.color = "link";
    expect(parseSavedSettings(updated).groups[0]!.color).toBe("link");
  });
});
