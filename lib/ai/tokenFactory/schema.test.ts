import { describe, expect, it } from "vitest";
import { reconciliationAnswerSchema, reconciliationJsonSchema } from "./schema";

// A claim as an answer from before structure labels carries it
const historical = {
  action: "add", unit: null, content: "Dana Lee leads Billing.", title: "Dana Lee leads Billing", kind: "fact", epistemicStatus: "supported",
  speechAct: "stated", passages: ["P1"], entities: [], domainPaths: [], reason: "",
};
const label = { from: { type: "person", key: "dana-lee" }, link: "leads", to: { type: "team", key: "billing" }, title: "Head of Billing", seniority: "director", share: null, current: true };

describe("reconciliation answer schema", () => {
  it("reads historical claims without structure labels as having none", () => {
    expect(reconciliationAnswerSchema.parse({ summary: "", claims: [historical] }).claims[0]?.stakeholderLinks).toEqual([]);
  });

  it("reads labels with the contract's links and seniorities, and rejects others", () => {
    const parse = (overrides: object) => reconciliationAnswerSchema.safeParse({ summary: "", claims: [{ ...historical, stakeholderLinks: [{ ...label, ...overrides }] }] });
    expect(parse({}).success).toBe(true);
    expect(parse({ link: "friends_with" }).success).toBe(false);
    expect(parse({ seniority: "boss" }).success).toBe(false);
    expect(parse({ link: "owned_by", share: 1.2 }).success).toBe(false);
    // An older type word is mapped onto the list, as on entities
    expect(parse({ to: { type: "department", key: "billing" } }).data?.claims[0]?.stakeholderLinks?.[0]?.to.type).toBe("team");
  });

  it("reads labels from before dates existed as having none", () => {
    const parsed = reconciliationAnswerSchema.parse({ summary: "", claims: [{ ...historical, stakeholderLinks: [label] }] });
    expect(parsed.claims[0]?.stakeholderLinks?.[0]).toMatchObject({ since: null, until: null });
  });

  it("asks guided decoding for the labels on every claim", () => {
    const claim = (reconciliationJsonSchema as unknown as { properties: { claims: { items: { required: string[]; properties: Record<string, unknown> } } } }).properties.claims.items;
    expect(claim.required).toContain("stakeholderLinks");
    expect(JSON.stringify(claim.properties.stakeholderLinks)).toContain("board_member_of");
    expect(JSON.stringify(claim.properties.stakeholderLinks)).toContain('"required":["from","link","to","title","seniority","share","current","since","until"]');
  });
});
