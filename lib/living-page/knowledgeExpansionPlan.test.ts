import { describe, expect, it } from "vitest";
import { expansionActions, validateExpansion, type ExpansionContext, type KnowledgeExpansion } from "./knowledgeExpansionPlan";

const context: ExpansionContext = {
  knowledge: { entity: { id: "company", type: "company", key: "acme", name: "Acme" }, units: [{ unitId: "u1", revisionId: "r1", content: "Acme requires protective equipment.", kind: "procedure", epistemicStatus: "established" }] },
  passages: [{ id: "p1", text: "Personal protective equipment is worn to protect workers from hazards.", sourceDate: "2025-04-16" }],
  domainPaths: ["Safety/PPE"], existingEntities: [{ type: "company", key: "acme", name: "Acme" }], definedEntityKeys: [],
};
const plan: KnowledgeExpansion = { concepts: [{ name: "Personal protective equipment", key: "ppe", type: "equipment", aliases: ["PPE"], definition: "Personal protective equipment is equipment worn to protect workers from hazards.", domainPath: "Safety/PPE", claims: ["C1"], passages: ["P1"] }] };

describe("source-backed knowledge expansion", () => {
  it("creates the subject before its definition, with actual passage IDs and source dates", () => {
    const actions = expansionActions(plan, context);
    expect(actions.map((action) => action.type)).toEqual(["create_entity", "add_claim"]);
    expect(actions[1]).toMatchObject({ passageIds: ["p1"], speechAct: "stated", input: { kind: "definition", validFrom: "2025-04-16", domainPaths: ["Safety/PPE"], entities: [{ type: "equipment", key: "ppe", role: "subject" }] } });
  });

  it("keeps general definitions independent from the handbook company", () => {
    const actions = expansionActions({ concepts: [{ ...plan.concepts[0]!, applicability: { status: "general", entities: [], conditions: null } }] }, context);
    expect(actions[1]?.input).toMatchObject({ context: { entities: [{ type: "equipment", key: "ppe", role: "subject" }], applicability: { status: "general", entities: [], conditions: null } } });
  });

  it("reuses a general definition globally but still allows a company-specific version", () => {
    const applicability = { status: "general" as const, entities: [], conditions: null };
    const known = { ...context, existingEntities: [...context.existingEntities, { type: "equipment", key: "ppe", name: "PPE" }], existingDefinitions: [{ entityKey: "equipment:ppe", context: { entities: [{ type: "equipment", key: "ppe", role: "subject" as const }], applicability } }] };
    expect(expansionActions({ concepts: [{ ...plan.concepts[0]!, applicability }] }, known)).toEqual([]);
    const scoped = expansionActions({ concepts: [{ ...plan.concepts[0]!, applicability: { status: "scoped", entities: [{ type: "company", key: "acme", name: "Acme" }], conditions: null } }] }, known);
    expect(scoped.map(action => action.type)).toEqual(["add_claim"]);
  });

  it("rejects restrictions on a supposedly general definition", () => {
    expect(() => expansionActions({ concepts: [{ ...plan.concepts[0]!, applicability: { status: "general", entities: [], conditions: "at Acme" } }] }, context)).toThrow("Only scoped");
  });

  it("rejects an invented applicability identity", () => {
    expect(() => expansionActions({ concepts: [{ ...plan.concepts[0]!, applicability: { status: "scoped", entities: [{ type: "company", key: "other", name: "Other" }], conditions: null } }] }, context)).toThrow("Unknown applicability entity");
  });

  it("does not recreate an already defined entity on another expansion", () => {
    expect(expansionActions(plan, { ...context, existingEntities: [...context.existingEntities, { type: "equipment", key: "ppe", name: "Personal protective equipment" }], definedEntityKeys: ["equipment:ppe"] })).toEqual([]);
  });

  it("rejects invented evidence, unknown claims, and unknown domains", () => {
    const concept = plan.concepts[0]!;
    expect(() => validateExpansion({ concepts: [{ ...concept, passages: ["P99"] }] }, context)).toThrow("Unknown source passage");
    expect(() => validateExpansion({ concepts: [{ ...concept, claims: ["C99"] }] }, context)).toThrow("Unknown claim");
    expect(() => validateExpansion({ concepts: [{ ...concept, domainPath: "Invented" }] }, context)).toThrow("Unknown domain");
  });
});
