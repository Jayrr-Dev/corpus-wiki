import { describe, expect, it } from "vitest";
import { acronymOf, type CleanupEntity, duplicateCandidates, normalizeName, readMerges, survivorOf } from "./entityCleanup";

const entity = (id: string, name: string, extra: Partial<CleanupEntity> = {}): CleanupEntity => ({
  id, type: "organization", key: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, aliases: [], description: null,
  claims: 1, anchored: false, inUse: true, ...extra,
});

describe("entity cleanup candidates", () => {
  it("normalizes legal suffixes, a leading article and punctuation", () => {
    expect(normalizeName("Utilitek Solutions Inc.")).toBe("utilitek solutions");
    expect(normalizeName("The City of Edmonton")).toBe("city of edmonton");
    expect(acronymOf("Federal Aviation Administration")).toBe("faa");
    expect(acronymOf("EPCOR")).toBeNull();
  });

  it("groups the same name across types, acronyms and bracketed short names", () => {
    const entities = [
      entity("1", "EPCOR", { type: "company" }), entity("2", "EPCOR", { type: "organization" }),
      entity("3", "FAA"), entity("4", "Federal Aviation Administration"),
      entity("5", "American Society for Quality (ASQ)"), entity("6", "ASQ"),
      entity("7", "Health Canada"),
      entity("8", "Stakeholder", { type: "role" }), entity("9", "Stakeholders", { type: "role" }),
    ];
    const groups = duplicateCandidates(entities, null).map((group) => group.map((e) => e.id).sort());
    expect(groups).toEqual(expect.arrayContaining([["1", "2"], ["3", "4"], ["5", "6"], ["8", "9"]]));
    expect(groups.flat()).not.toContain("7");
    // An upload only re-judges groups it touched
    expect(duplicateCandidates(entities, new Set(["3"])).map((group) => group.map((e) => e.id).sort())).toEqual([["3", "4"]]);
  });

  it("keeps the entity that anchors content, then the one with more claims", () => {
    expect(survivorOf([entity("a", "X", { claims: 9 }), entity("b", "X", { claims: 1, anchored: true })])?.id).toBe("b");
    expect(survivorOf([entity("a", "X", { claims: 9 }), entity("b", "X", { claims: 1 })])?.id).toBe("a");
    expect(survivorOf([entity("a", "X", { anchored: true }), entity("b", "X", { anchored: true })])).toBeNull();
  });

  it("merges only sets the judge was sure of, within their own group", () => {
    const groups = [[entity("1", "EPCOR", { claims: 3 }), entity("2", "EPCOR", { claims: 0 })], [entity("3", "Mercury"), entity("4", "Mercury")]];
    const merges = readMerges({ groups: [
      { ref: "G1", same: [["G1.1", "G1.2"]], reason: "Same utility" },
      { ref: "G2", same: [], reason: "A planet and a company" },
      { ref: "G9", same: [["G9.1", "G9.2"]], reason: "Unknown group" },
    ] }, groups);
    expect(merges.map((merge) => [merge.from.id, merge.into.id])).toEqual([["2", "1"]]);
  });
});
