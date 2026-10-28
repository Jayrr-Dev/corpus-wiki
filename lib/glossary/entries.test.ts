import { describe, expect, it } from "vitest";
import { dictionaryAnswerSchema, dictionaryResponseSchema, droppedProtectedClaims, glossaryClearHomes, glossaryLetter, glossaryScopeKey, mergeGlossaryEntries, restoreDroppedCitations, visibleGlossaryEntries, withoutMovedCitations, type GlossaryEntry } from "./entries";
import { parseContent } from "../ai/chat";
import { z } from "zod";

function entry(values: Partial<GlossaryEntry> = {}): GlossaryEntry {
  return { term: "PPE", expansion: "Personal Protective Equipment", aliases: [], category: "acronym",
    definition: "Equipment worn to reduce exposure to workplace hazards.", context: null, scopeKey: "general",
    citations: [{ unitId: "u1", revisionId: "r1", sourceId: "s1", sourceTitle: "Safety handbook" }], ...values };
}

it("shows live replacements without duplicating merged meanings or hiding other senses", () => {
  const first = entry({ meaningId: "first" });
  const merged = entry({ meaningId: "merged" });
  const other = entry({ meaningId: "other", definition: "Another supported meaning of the same term." });
  const live = entry({ meaningId: "first", redirectIds: ["merged"], definition: "Updated reviewed definition." });
  expect(visibleGlossaryEntries([first, merged, other], [live])).toEqual([other, live]);
  expect(visibleGlossaryEntries([other])).toEqual([other]);
});

describe("generated dictionary entries", () => {
  it("accepts category label variations and preserves the whole batch through response validation", () => {
    const labels = ["general term", "ACRONYM", "technical_term", "uncommon-word", "jargon", "regulatory term"];
    const entries = labels.map((category, i) => ({ ...entry({ term: `Term ${i}` }), category, citations: ["K1"] }));
    const result = parseContent({ choices: [{ message: { content: JSON.stringify({ entries }) }, finish_reason: "stop" }] }, dictionaryResponseSchema);
    expect(result.entries.map((item) => item.category)).toEqual(["general term", "acronym", "technical term", "uncommon word", "jargon", "general term"]);
    expect(result.entries.map((item) => item.definition)).toEqual(entries.map((item) => item.definition));
    expect(result.entries.every((item) => item.citations[0] === "K1")).toBe(true);
    const wireSchema = z.toJSONSchema(dictionaryAnswerSchema);
    expect(JSON.stringify(wireSchema)).toContain('"enum":["general term","acronym","technical term","jargon","uncommon word"]');
    expect(dictionaryAnswerSchema.safeParse({ entries }).success).toBe(false);
  });
  it("still rejects missing categories, malformed fields, and unsupported entries", () => {
    for (const category of [undefined, null, 42, {}, "", "   "]) {
      expect(dictionaryResponseSchema.safeParse({ entries: [{ ...entry(), category, citations: ["K1"] }] }).success).toBe(false);
    }
    expect(dictionaryResponseSchema.safeParse({ entries: [{ ...entry(), category: "regulatory term", citations: [] }] }).success).toBe(false);
    expect(dictionaryResponseSchema.safeParse({ entries: [{ ...entry(), category: "regulatory term", definition: "", citations: ["K1"] }] }).success).toBe(false);
  });
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
  it("attaches a claim that already names a saved headword and leaves the rest", () => {
    const scope = glossaryScopeKey([{ status: "general", entities: [] }]);
    const saved = entry({ scopeKey: scope });
    const cite = { unitId: "u9", revisionId: "r9", sourceId: "s9", sourceTitle: "Field note" };
    const placed = glossaryClearHomes([
      { text: "Workers wear personal protective equipment on site.", scopeKey: scope, citations: [cite], label: "home" },
      { text: "Quality inspection is a separate idea.", scopeKey: scope, citations: [cite], label: "other" },
    ], [saved]);
    expect(placed.leftovers.map((item) => item.label)).toEqual(["other"]);
    expect(placed.entries[0]?.citations.map((item) => item.unitId)).toEqual(["u1", "u9"]);
    expect(saved.citations).toHaveLength(1);
  });
  it("does not attach a claim when two saved senses share the name", () => {
    const scope = glossaryScopeKey([{ status: "general", entities: [] }]);
    const cite = { unitId: "u9", revisionId: "r9", sourceId: "s9", sourceTitle: "Field note" };
    const placed = glossaryClearHomes([
      { text: "PPE is required in the plant.", scopeKey: scope, citations: [cite] },
    ], [entry({ scopeKey: scope }), entry({ scopeKey: scope, expansion: "Property Plant and Equipment", definition: "Long-lived physical assets used in operations." })]);
    expect(placed.leftovers).toHaveLength(1);
    expect(placed.entries[0]?.citations).toHaveLength(1);
  });
  it("writes a dropped citation back onto the same headword and reports it missing", () => {
    const scope = glossaryScopeKey([{ status: "general", entities: [] }]);
    const kept = { unitId: "u1", revisionId: "r1", sourceId: "s1", sourceTitle: "Safety handbook" };
    const dropped = { unitId: "u2", revisionId: "r2", sourceId: "s2", sourceTitle: "Training guide" };
    const previous = entry({ scopeKey: scope, citations: [kept, dropped] });
    const produced = entry({ scopeKey: scope, definition: "A rewritten meaning of the same equipment.", citations: [kept] });
    const restored = restoreDroppedCitations([produced], [previous], [dropped]);
    expect(restored).toHaveLength(1);
    expect(restored[0]?.citations.map((item) => item.unitId)).toEqual(["u1", "u2"]);
    expect(droppedProtectedClaims(["u1", "u2", "u3"], ["u1"], ["u2"])).toEqual(["u2"]);
    const moved = withoutMovedCitations([previous, entry({ term: "Dropped", scopeKey: scope, citations: [dropped] })], new Set(["u2"]));
    expect(moved).toHaveLength(1);
    expect(moved[0]?.citations).toEqual([kept]);
  });
  it("indexes accented headwords and groups numeric terms separately", () => {
    expect(glossaryLetter("étiology")).toBe("E");
    expect(glossaryLetter("1:10:100 ratio")).toBe("#");
  });
});
