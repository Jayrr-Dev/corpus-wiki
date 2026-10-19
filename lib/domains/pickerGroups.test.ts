import { describe, expect, it } from "vitest";
import { domainPickerGroup } from "./pickerGroups";

const groups = [
  { id: "internal", label: "Internal", domains: [] },
  { id: "external", label: "External", domains: [{ id: "Personality", path: "Personality" }] },
];

describe("domainPickerGroup", () => {
  it("opens the populated tab when Internal is empty", () => {
    expect(domainPickerGroup(groups, "")?.id).toBe("external");
  });

  it("allows explicitly visiting an empty tab", () => {
    expect(domainPickerGroup(groups, "internal")?.id).toBe("internal");
  });

  it("falls back to a populated tab when the previous tab disappears", () => {
    expect(domainPickerGroup(groups, "removed")?.id).toBe("external");
  });

  it("handles empty and ungrouped pickers", () => {
    expect(domainPickerGroup(groups.map((group) => ({ ...group, domains: [] })), "")?.id).toBe("internal");
    expect(domainPickerGroup([], "")).toBeUndefined();
    expect(domainPickerGroup(undefined, "")).toBeUndefined();
  });
});
