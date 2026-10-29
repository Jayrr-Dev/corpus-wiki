import { describe, expect, it } from "vitest";
import { articleGroups, entityGroups, mostVoted, topicGroups } from "./scopeGroups";
import { scopeTitle } from "./scopeTypes";

describe("topicGroups", () => {
  it("puts each top-level topic first and its sub-topics below in tree order", () => {
    const groups = topicGroups([
      { id: "hs-entry", label: "Acme › Health & Safety › Entry" },
      { id: "acme", label: "Acme" },
      { id: "hs", label: "Acme › Health & Safety" },
      { id: "beta", label: "Beta" },
    ]);
    expect(groups).toEqual([
      { label: "Acme", rows: [{ id: "acme", name: "All of Acme", depth: 0 }, { id: "hs", name: "Health & Safety", depth: 1 }, { id: "hs-entry", name: "Entry", depth: 2 }] },
      { label: "Beta", rows: [{ id: "beta", name: "All of Beta", depth: 0 }] },
    ]);
  });
});

describe("articleGroups", () => {
  it("files articles under headings for their sub-topics, top-level ones first", () => {
    const groups = articleGroups([
      { id: "permits", label: "Permits", group: "Acme › Health & Safety" },
      { id: "overview", label: "Overview", group: "Acme" },
      { id: "gas", label: "Gas testing", group: "Acme › Health & Safety › Entry" },
      { id: "loose", label: "Loose page" },
    ]);
    expect(groups).toEqual([
      {
        label: "Acme",
        rows: [
          { id: "overview", name: "Overview", depth: 0 },
          { id: null, name: "Health & Safety", depth: 0 },
          { id: "permits", name: "Permits", depth: 1 },
          { id: null, name: "Entry", depth: 1 },
          { id: "gas", name: "Gas testing", depth: 2 },
        ],
      },
      { label: "No topic", rows: [{ id: "loose", name: "Loose page", depth: 0 }] },
    ]);
  });
});

describe("entityGroups", () => {
  it("groups by type, names in order", () => {
    expect(entityGroups([
      { id: "b", label: "Bea", group: "Person" },
      { id: "a", label: "Acme", group: "Organization" },
      { id: "c", label: "Al", group: "Person" },
    ])).toEqual([
      { label: "Organization", rows: [{ id: "a", name: "Acme", depth: 0 }] },
      { label: "Person", rows: [{ id: "c", name: "Al", depth: 0 }, { id: "b", name: "Bea", depth: 0 }] },
    ]);
  });
});

describe("mostVoted", () => {
  it("picks the most votes, a tie going to the name that sorts first", () => {
    expect(mostVoted(["b", "a", "b"])).toBe("b");
    expect(mostVoted(["id-z", "id-a"], (id) => (id === "id-z" ? "Alpha" : "Beta"))).toBe("id-z");
    expect(mostVoted([])).toBeNull();
  });
});

describe("scopeTitle", () => {
  const options = { topic: [{ id: "hs", label: "Acme › Health & Safety" }], article: [{ id: "p", label: "Permits" }], entity: [] };
  it("names a glossary by its topic, and other scopes by their choice", () => {
    expect(scopeTitle({ kind: "glossary", id: "hs" }, options, "x")).toBe("Glossary: Health & Safety");
    expect(scopeTitle({ kind: "glossary" }, options, "x")).toBe("Glossary");
    expect(scopeTitle({ kind: "article", id: "p" }, options, "x")).toBe("Permits");
    expect(scopeTitle({ kind: "entity", id: "gone" }, options, "x")).toBe("x");
  });
});
