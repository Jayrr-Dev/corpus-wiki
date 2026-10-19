import { describe, expect, it } from "vitest";
import { buildSuggestionMessages, readSuggestions, type SuggestionInput, type SuggestionsAnswer } from "./suggest";

const claim = (n: number) => ({ unitId: `u${n}`, revisionId: `r${n}`, content: `Claim ${n}`, kind: "fact" as const, epistemicStatus: "stated" as never, topics: ["Safety"], entityIds: n === 1 ? ["e1"] : [] });
const input: SuggestionInput = {
  charter: { purpose: "Field work", audience: "", outOfScope: "" },
  articles: [
    { id: "page-1", title: "Lockout procedure", type: "process", scope: null, parentId: null, claimCount: 9 },
    { id: "page-2", title: "Safety", type: "concept", scope: null, parentId: null, claimCount: 3 },
  ],
  closest: [{ id: "page-1", closeness: 0.81, sections: [{ id: "sec-1", title: "Steps" }, { id: "sec-2", title: "Tools" }] }],
  entities: [{ id: "e1", type: "organization", key: "acme", name: "Acme" }],
  claims: [1, 2, 3, 4, 5].map(claim),
  signals: { cohesion: 0.8, links: 1, sharedEntityIds: [], sharedDomainIds: [], sharedSources: 0, sharedEntities: [], sharedDomains: ["Safety"] },
};
type Item = SuggestionsAnswer["suggestions"][number];
const create = (overrides: Partial<Item> = {}): Item => ({ action: "create", article: null, title: "Confined spaces", type: "requirement", scope: "Entry rules.", parent: null, entity: null,
  rationale: "Distinct subject.", sections: [{ title: "Entry", existingSection: null, claims: ["C1", "C2"] }, { title: "Permits", existingSection: null, claims: ["C3"] }], ...overrides });
const merge = (overrides: Partial<Item> = {}): Item => ({ action: "merge", article: "P1", title: "", type: null, scope: "", parent: null, entity: null,
  rationale: "Fits.", sections: [{ title: "ignored", existingSection: "S2", claims: ["C4"] }, { title: "Isolation", existingSection: null, claims: ["C5"] }], ...overrides });

describe("readSuggestions", () => {
  it("resolves a new article and a merge into ids", () => {
    const [created, merged] = readSuggestions({ suggestions: [create({ parent: "P2" }), merge()] }, input);
    expect(created).toMatchObject({ kind: "create", title: "Confined spaces", parentPageId: "page-2", unitIds: ["u1", "u2", "u3"], revisionIds: ["r1", "r2", "r3"] });
    expect(merged).toMatchObject({ kind: "merge", pageId: "page-1", title: "Lockout procedure" });
    expect(merged!.sections).toEqual([{ title: "Tools", sectionId: "sec-2", unitIds: ["u4"] }, { title: "Isolation", sectionId: null, unitIds: ["u5"] }]);
  });

  it("refuses a claim used twice", () => {
    expect(() => readSuggestions({ suggestions: [create(), merge({ sections: [{ title: "X", existingSection: null, claims: ["C1"] }] })] }, input)).toThrow(/more than once/);
  });

  it("refuses a new article with too few claims or an existing title", () => {
    expect(() => readSuggestions({ suggestions: [create({ sections: [{ title: "Entry", existingSection: null, claims: ["C1", "C2"] }] })] }, input)).toThrow(/at least 3/);
    expect(() => readSuggestions({ suggestions: [create({ title: "lockout procedure" })] }, input)).toThrow(/already exists/);
  });

  it("refuses unknown refs and sections of another article", () => {
    expect(() => readSuggestions({ suggestions: [create({ sections: [{ title: "A", existingSection: null, claims: ["C9", "C1", "C2"] }] })] }, input)).toThrow(/unknown claim/);
    expect(() => readSuggestions({ suggestions: [merge({ article: "P2" })] }, input)).toThrow(/another article/);
    expect(() => readSuggestions({ suggestions: [merge({ article: null })] }, input)).toThrow(/P ref/);
  });

  it("needs the entity for an entity article", () => {
    expect(() => readSuggestions({ suggestions: [create({ type: "entity" })] }, input)).toThrow(/E ref/);
    expect(readSuggestions({ suggestions: [create({ type: "entity", entity: "E1" })] }, input)[0]!.entityId).toBe("e1");
  });
});

describe("buildSuggestionMessages", () => {
  it("numbers the closest articles' sections in the order readSuggestions resolves them", () => {
    const payload = JSON.parse(buildSuggestionMessages("x", input)[1]!.content as string);
    expect(payload.closest[0]).toEqual({ article: "P1", closeness: 0.81, sections: [{ ref: "S1", title: "Steps" }, { ref: "S2", title: "Tools" }] });
    expect(payload.claims[0]).toMatchObject({ ref: "C1", about: ["E1"] });
  });
});
