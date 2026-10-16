import { describe, expect, it } from "vitest";
import { profileInputHash, type ProfileEvidence, readProfiles } from "./entityProfiles";

const evidence = (entityId: string, claims: number): ProfileEvidence => ({
  entityId, type: "company", name: `Entity ${entityId}`, aliases: [], description: null, related: [],
  claims: Array.from({ length: claims }, (_, i) => ({ unitId: `${entityId}-u${i + 1}`, revisionId: `${entityId}-r${i + 1}`, title: "", content: `Claim ${i + 1}`, kind: "fact", role: "subject" })),
});

describe("stakeholder card answers", () => {
  it("maps refs back to entities and claims, caps lists and clears non-stakeholders", () => {
    const entities = [evidence("a", 3), evidence("b", 1)];
    const rows = readProfiles({ profiles: [
      { ref: "e1", isStakeholder: true, kind: "Government Agency.", relation: "Regulates our work.",
        keyFacts: [...Array.from({ length: 7 }, (_, i) => ({ label: `L${i}`, value: "v", claims: ["C1", "C9"] })), { label: "", value: "x", claims: [] }],
        functions: [{ text: "Issues permits", claims: ["C2", "C2"] }],
        contacts: [{ kind: "Email", value: "permits@example.org", label: null, claims: ["C3"] }, { kind: "fax", value: "123", label: "Main", claims: [] }] },
      { ref: "E2", isStakeholder: false, kind: "concept", relation: "x", keyFacts: [{ label: "a", value: "b", claims: [] }], functions: [], contacts: [] },
      { ref: "E7", isStakeholder: true, kind: "", relation: "", keyFacts: [], functions: [], contacts: [] },
    ] }, entities);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ entityId: "a", kind: "government agency", relation: "Regulates our work." });
    expect(rows[0]!.keyFacts).toHaveLength(5);
    expect(rows[0]!.keyFacts[0]!.unitIds).toEqual(["a-u1"]);
    expect(rows[0]!.functions[0]!.unitIds).toEqual(["a-u2"]);
    expect(rows[0]!.contacts.map((contact) => contact.kind)).toEqual(["email", "other"]);
    expect(rows[1]).toEqual({ entityId: "b", isStakeholder: false, kind: null, relation: null, keyFacts: [], functions: [], contacts: [] });
  });

  it("hashes the evidence, not its order, and changes with the anchor organization", () => {
    const one = evidence("a", 2);
    const reordered = { ...one, claims: [...one.claims].reverse() };
    expect(profileInputHash(one, null)).toBe(profileInputHash(reordered, null));
    expect(profileInputHash(one, null)).not.toBe(profileInputHash(one, "our-org"));
  });
});
