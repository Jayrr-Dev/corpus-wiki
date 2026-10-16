import { describe, expect, it } from "vitest";
import { buildReclassifyMessages, readRetypes, reclassifyAnswerSchema, type ReclassifyEntity } from "./entityReclassify";

const entity = (id: string, name: string): ReclassifyEntity => ({ id, type: "concept", key: name.toLowerCase().replace(/\s+/g, "-"), name, aliases: [], description: null, claims: [`${name} is used on site.`] });

describe("entity reclassify answers", () => {
  const entities = [entity("a", "Inspection Report Template"), entity("b", "Hazardous Product"), entity("c", "First-Party Inspectors"), entity("d", "ISO 9001")];

  it("keeps real retypes and drops concept answers, unknown refs, repeats and taken slots", () => {
    const answer = reclassifyAnswerSchema.parse({ entities: [
      { ref: "E1", type: "document", reason: "A template" },
      { ref: "e2", type: "concept", reason: "A term" },
      { ref: "E3", type: "Role", reason: "" },
      { ref: "E3", type: "team", reason: "Repeat" },
      { ref: "E4", type: "standard", reason: "A standard" },
      { ref: "E9", type: "tool", reason: "Unknown" },
    ] });
    const retypes = readRetypes(answer, entities, new Set(["standard:iso-9001"]));
    expect(retypes.map((retype) => [retype.entity.id, retype.type, retype.reason])).toEqual([
      ["a", "document", "A template"],
      ["c", "role", "It is a role"],
    ]);
  });

  it("maps a stray type word onto the list", () => {
    expect(reclassifyAnswerSchema.parse({ entities: [{ ref: "E1", type: "template", reason: "" }] }).entities[0]!.type).toBe("document");
  });

  it("sends names, descriptions and clipped claims, never ids", () => {
    const [, user] = buildReclassifyMessages([{ ...entity("secret-id", "CMM"), claims: ["x".repeat(500)] }]);
    expect(user!.content).not.toContain("secret-id");
    expect(JSON.parse(user!.content as string).entities[0].claims[0].length).toBeLessThanOrEqual(240);
  });
});
