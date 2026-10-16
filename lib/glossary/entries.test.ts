import { describe, expect, it } from "vitest";
import { dictionaryAnswerSchema, glossaryLetter, glossaryScopeKey, mergeGlossaryEntries, type GlossaryEntry } from "./entries";

function entry(values: Partial<GlossaryEntry> = {}): GlossaryEntry {
  return { term: "PPE", expansion: "Personal Protective Equipment", aliases: [], category: "acronym",
    definition: "Equipment worn to reduce exposure to workplace hazards.", context: null, scopeKey: "general",
    citations: [{ unitId: "u1", revisionId: "r1", sourceId: "s1", sourceTitle: "Safety handbook" }], ...values };
}

describe("generated dictionary entries", () => {
  it("unifies an evidenced acronym and full name while preserving their provenance", () => {
    const result = mergeGlossaryEntries([entry(), entry({ term: "personal protective equipment", expansion: null,
      citations: [{ unitId: "u2", revisionId: "r2", sourceId: "s2", sourceTitle: "Training guide" }] })]);
    expect(result).toHaveLength(1);
    expect(result[0]?.citations.map((cite) => cite.sourceId)).toEqual(["s1", "s2"]);
    expect(result[0]?.aliases).toContain("personal protective equipment");
  });
  it("keeps different acronym expansions and scoped meanings separate", () => {
    const result = mergeGlossaryEntries([entry(), entry({ expansion: "Property Plant and Equipment" }),
      entry({ context: "Acme", scopeKey: "Acme" })]);
    expect(result).toHaveLength(3);
  });
  it("merges same-entity meanings whatever their conditions say", () => {
    const edmonton = (conditions: string) => ({ status: "scoped", entities: [{ type: "organization", key: "city-of-edmonton" }], conditions });
    const a = glossaryScopeKey([edmonton("Installing utility assets within the road allowance")]);
    const b = glossaryScopeKey([edmonton("Aerial and underground facilities"), edmonton("Ground disturbance over 1m")]);
    expect(a).toBe(b);
    expect(mergeGlossaryEntries([entry({ scopeKey: a }), entry({ scopeKey: b, definition: "A longer definition of the same meaning." })])).toHaveLength(1);
    expect(glossaryScopeKey([{ status: "general", entities: [] }])).not.toBe(a);
  });
  it("joins scoped meanings that share an entity, transitively, but never with unscoped ones", () => {
    const scope = (...keys: string[]) => glossaryScopeKey([{ status: "scoped", entities: keys.map((key) => ({ key })) }]);
    const general = glossaryScopeKey([{ status: "general", entities: [] }]);
    const result = mergeGlossaryEntries([entry({ scopeKey: scope("designer", "stakeholder") }), entry({ scopeKey: scope("city-of-edmonton") }),
      entry({ scopeKey: scope("city-of-edmonton", "designer") }), entry({ scopeKey: general }), entry({ scopeKey: scope("acme") })]);
    expect(result).toHaveLength(3);
    expect(result.map((item) => item.scopeKey)).toContain(`[${JSON.stringify(["city-of-edmonton", "designer", "stakeholder"])}]`);
  });
  it("rejects entries with no source references or no meaning", () => {
    expect(dictionaryAnswerSchema.safeParse({ entries: [{ term: "PPE", expansion: null, aliases: [], category: "acronym", definition: "Protection", citations: [] }] }).success).toBe(false);
  });
  it("indexes accented headwords and groups numeric terms separately", () => {
    expect(glossaryLetter("étiology")).toBe("E");
    expect(glossaryLetter("1:10:100 ratio")).toBe("#");
  });
});
