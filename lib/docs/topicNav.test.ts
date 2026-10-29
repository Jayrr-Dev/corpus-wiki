import { describe, expect, it } from "vitest";
import { docsTopicNav, topicNavKeyFor, topicNavSetIds } from "./topicNav";

const options = {
  topic: [
    { id: "t-acme", label: "Acme" },
    { id: "t-acme-hs", label: "Acme › Health & Safety" },
    { id: "t-entry", label: "Acme › Health & Safety › Confined Space Entry" },
    { id: "t-air", label: "Acme › Health & Safety › Confined Space Entry › Atmosphere Testing" },
    { id: "t-other-hs", label: "Beta › Health & Safety" },
    { id: "t-ops", label: "Acme › Operations" },
    { id: "t-quality", label: "Quality" },
  ],
};

describe("docs topic nav", () => {
  it("makes a button of each second-level topic with docs, never the top level", () => {
    const nav = docsTopicNav([
      { id: "s1", title: "Testing atmosphere", scopeKind: "topic", scopeId: "t-air" },
      { id: "s2", title: "Entry procedure", scopeKind: "topic", scopeId: "t-entry" },
      { id: "s3", title: "Operations", scopeKind: "topic", scopeId: "t-ops" },
      { id: "s4", title: "Terms", scopeKind: "glossary", scopeId: null },
    ], options);
    expect(nav).toEqual([
      // Health & Safety is under two companies, so New docs has no single topic to start from
      { key: "topic:Health & Safety", label: "Health & Safety", topicId: null, sections: [
        { label: "Confined Space Entry", sets: [{ id: "s2", title: "Entry procedure" }] },
        { label: "Confined Space Entry › Atmosphere Testing", sets: [{ id: "s1", title: "Testing atmosphere" }] },
      ] },
      { key: "topic:Operations", label: "Operations", topicId: "t-ops", sections: [{ label: null, sets: [{ id: "s3", title: "Operations" }] }] },
      { key: "glossary", label: "Glossary", topicId: null, sections: [{ label: null, sets: [{ id: "s4", title: "Terms" }] }] },
    ]);
    expect(topicNavKeyFor(nav, "s1")).toBe("topic:Health & Safety");
    expect([...topicNavSetIds(nav, "topic:Health & Safety") ?? []]).toEqual(["s2", "s1"]);
    expect(topicNavSetIds(nav, "topic:Nope")).toBeNull();
  });

  it("puts sets on a top-level topic, or on a topic that is gone, under Other topics", () => {
    const nav = docsTopicNav([
      { id: "s1", title: "About Acme", scopeKind: "topic", scopeId: "t-acme" },
      { id: "s2", title: "Old", scopeKind: "topic", scopeId: "t-retired" },
      { id: "s3", title: "Operations", scopeKind: "topic", scopeId: "t-ops" },
    ], options);
    expect(nav.map((item) => [item.label, item.sections.flatMap((section) => section.sets.map((set) => set.id))])).toEqual([
      ["Operations", ["s3"]],
      ["Other topics", ["s1", "s2"]],
    ]);
  });
});
