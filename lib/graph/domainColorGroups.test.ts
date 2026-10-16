import { describe, expect, it } from "vitest";
import { DEFAULT_GRAPH_SETTINGS, parseSavedSettings, withDomainColorGroups } from "./settings";
import { groupColorLookup } from "./groups";
import type { GraphNode } from "./types";

const nodes = (...paths: string[]): GraphNode[] => paths.map((path, index) => ({
  id: String(index), kind: "unit", label: path, text: path, href: "", createdAt: "",
  degree: 0, domainPaths: [path], entityNames: [], unitKind: null, status: null,
}));

describe("automatic domain color groups", () => {
  it("colors the next layer before its parent and inherits that color deeper down", () => {
    const data = nodes("Safety/Training", "Quality/Inspection", "Safety/Equipment");
    const settings = withDomainColorGroups(DEFAULT_GRAPH_SETTINGS, data);
    expect(settings.groups.map((group) => group.query)).toEqual(["domain:Quality/Inspection", "domain:Quality", "domain:Safety/Equipment", "domain:Safety/Training", "domain:Safety"]);
    const training = settings.groups.find((group) => group.query === "domain:Safety/Training")!;
    expect(groupColorLookup(settings.groups)(data[0]!)).toBe(training.color);
    expect(groupColorLookup(settings.groups)(nodes("Safety/Training/Orientation")[0]!)).toBe(training.color);
    expect(training.color).not.toBe(settings.groups.find((group) => group.query === "domain:Safety")!.color);
  });

  it("keeps edits and deletions after reload while coloring newly added domains", () => {
    const initial = withDomainColorGroups(DEFAULT_GRAPH_SETTINGS, nodes("Safety", "Quality"));
    const customized = parseSavedSettings(JSON.parse(JSON.stringify({ ...initial,
      groups: [{ ...initial.groups[0]!, color: "link", query: "domain:Quality/Inspection" }],
    })));
    const next = withDomainColorGroups(customized, nodes("Safety", "Quality", "Operations"));
    expect(next.groups[0]).toEqual(customized.groups[0]);
    expect(next.groups.map((group) => group.query)).toEqual(["domain:Quality/Inspection", "domain:Operations"]);
    expect(withDomainColorGroups(next, [])).toBe(next);
  });

  it("preserves existing custom groups and does not duplicate legacy domain groups", () => {
    const custom = { id: "custom", query: "domain:Safety", color: "link" as const };
    const settings = withDomainColorGroups({ ...DEFAULT_GRAPH_SETTINGS, groups: [custom] }, nodes("Safety/Training"));
    expect(settings.groups[1]).toEqual(custom);
    expect(settings.groups[0]!.query).toBe("domain:Safety/Training");
    expect(settings.colorGroupDomains).toEqual(["safety", "safety/training"]);
  });

  it("upgrades saved roots without changing them and remembers child edits and removals", () => {
    const roots = withDomainColorGroups(DEFAULT_GRAPH_SETTINGS, nodes("Safety"));
    const upgraded = withDomainColorGroups(roots, nodes("Safety/Training/Orientation", "Safety/Equipment"));
    expect(upgraded.groups.find((group) => group.query === "domain:Safety")).toEqual(roots.groups[0]);
    expect(upgraded.groups).toHaveLength(4);
    const saved = parseSavedSettings({ ...upgraded, groups: upgraded.groups.filter((group) => group.query !== "domain:Safety/Equipment").map((group) => group.query === "domain:Safety/Training" ? { ...group, color: "link" } : group) });
    const refreshed = withDomainColorGroups(saved, nodes("Safety/Training", "Safety/Equipment", "Safety/Reporting"));
    expect(refreshed.groups.some((group) => group.query === "domain:Safety/Equipment")).toBe(false);
    expect(groupColorLookup(refreshed.groups)(nodes("Safety/Training")[0]!)).toBe("link");
    expect(refreshed.groups.some((group) => group.query === "domain:Safety/Reporting")).toBe(true);
  });

  it("keeps children distinct from their parent after the palette wraps", () => {
    const data = nodes(...Array.from({ length: 15 }, (_, i) => "Safety/Topic " + i));
    const settings = withDomainColorGroups(DEFAULT_GRAPH_SETTINGS, data);
    const parent = settings.groups.find((group) => group.query === "domain:Safety")!;
    expect(settings.groups.filter((group) => group !== parent).every((group) => group.color !== parent.color)).toBe(true);
    expect(withDomainColorGroups(settings, data)).toBe(settings);
  });

  it("waits for data and regenerates defaults after reset", () => {
    expect(withDomainColorGroups(DEFAULT_GRAPH_SETTINGS, [])).toBe(DEFAULT_GRAPH_SETTINGS);
    const initial = withDomainColorGroups(DEFAULT_GRAPH_SETTINGS, nodes("Safety"));
    expect(withDomainColorGroups(DEFAULT_GRAPH_SETTINGS, nodes("Safety"))).toEqual(initial);
  });

  it("adds a third level ahead of both ancestors and stops generating at that level", () => {
    const existing = withDomainColorGroups(DEFAULT_GRAPH_SETTINGS, nodes("Company/Safety"));
    const settings = withDomainColorGroups(existing, nodes("Company/Safety/WHMIS/Labels"));
    expect(settings.groups.map((group) => group.query)).toEqual(["domain:Company/Safety/WHMIS", "domain:Company/Safety", "domain:Company"]);
    expect(settings.groups.slice(1)).toEqual(existing.groups);
    expect(new Set(settings.groups.map((group) => group.color)).size).toBe(3);
    expect(groupColorLookup(settings.groups)(nodes("Company/Safety/WHMIS/Labels")[0]!)).toBe(settings.groups[0]!.color);
    const saved = parseSavedSettings({ ...settings, groups: settings.groups.map((group, i) => i === 0 ? { ...group, color: "link" } : group) });
    expect(groupColorLookup(withDomainColorGroups(saved, nodes("Company/Safety/WHMIS/Labels")).groups)(nodes("Company/Safety/WHMIS")[0]!)).toBe("link");
  });

  it("places a third-level rule before the root even when the intermediate rule was removed", () => {
    const initial = withDomainColorGroups(DEFAULT_GRAPH_SETTINGS, nodes("Company/Safety"));
    const edited = { ...initial, groups: initial.groups.filter((group) => group.query !== "domain:Company/Safety") };
    const settings = withDomainColorGroups(edited, nodes("Company/Safety/WHMIS"));
    expect(settings.groups.map((group) => group.query)).toEqual(["domain:Company/Safety/WHMIS", "domain:Company"]);
    expect(groupColorLookup(settings.groups)(nodes("Company/Safety/WHMIS")[0]!)).toBe(settings.groups[0]!.color);
  });
});
