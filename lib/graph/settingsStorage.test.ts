import { describe, expect, it } from "vitest";
import { graphSettingsStorageKey, loadGraphSettings } from "./settingsStorage";
import { DEFAULT_GRAPH_SETTINGS, withDomainColorGroups } from "./settings";
import type { GraphNode } from "./types";

describe("space graph settings", () => {
  const oldSettings = { ...DEFAULT_GRAPH_SETTINGS,
    filters: { ...DEFAULT_GRAPH_SETTINGS.filters, domain: "Old company" },
    groups: [{ id: "old", query: "domain:Old company", color: "link" }],
    colorGroupDomains: ["old company"],
  };
  const saved = new Map([
    ["graph:global", JSON.stringify(oldSettings)],
    [graphSettingsStorageKey("graph:global", "old-space"), JSON.stringify(oldSettings)],
  ]);
  const storage = { getItem: (key: string) => saved.get(key) ?? null };

  it("does not import legacy rules, filters or discovered domains into another space", () => {
    const settings = loadGraphSettings(storage, graphSettingsStorageKey("graph:global", "new-space"));
    expect(settings).toEqual(DEFAULT_GRAPH_SETTINGS);
    const node = { domainPaths: ["Personality/Types"] } as GraphNode;
    const colored = withDomainColorGroups(settings, [node]);
    expect(colored.groups.map((group) => group.query)).toEqual(["domain:Personality/Types", "domain:Personality"]);
    expect(colored.colorGroupDomains).not.toContain("old company");
  });

  it("restores a space's own custom colors and filters when returning", () => {
    expect(loadGraphSettings(storage, graphSettingsStorageKey("graph:global", "old-space"))).toEqual(oldSettings);
  });

  it("uses defaults when storage is blocked or malformed", () => {
    expect(loadGraphSettings({ getItem: () => { throw new Error("blocked"); } }, "key")).toEqual(DEFAULT_GRAPH_SETTINGS);
    expect(loadGraphSettings({ getItem: () => "{" }, "key")).toEqual(DEFAULT_GRAPH_SETTINGS);
  });
});
