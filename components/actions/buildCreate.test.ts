import { describe, expect, it } from "vitest";
import { buildAddClaim, buildCreateDomain, buildCreateEntity, entityKey } from "./buildCreate";

describe("create builders", () => {
  it("keys an entity like the AI does", () => {
    expect(entityKey("  Project  Alpha ")).toBe("project-alpha");
    expect(buildCreateEntity({ name: "Project Alpha", type: "Project", aliases: "Alpha, , PA" })).toEqual({
      type: "create_entity",
      targetId: null,
      expectedRevisionId: null,
      passageIds: [],
      speechAct: null,
      input: { type: "project", key: "project-alpha", name: "Project Alpha", aliases: ["Alpha", "PA"] },
    });
  });

  it("builds a domain path under its parent, or a root", () => {
    expect(buildCreateDomain(" Data layer ", "Projects/Alpha").input).toEqual({ name: "Data layer", path: "Projects/Alpha/Data layer", parentPath: "Projects/Alpha" });
    expect(buildCreateDomain("Projects", null).input).toEqual({ name: "Projects", path: "Projects", parentPath: null });
  });

  it("builds add_claim with the entity as subject", () => {
    const action = buildAddClaim({
      content: " Alpha ships in Q2. ",
      kind: "fact",
      epistemicStatus: "established",
      validFrom: "2026-10-14",
      entity: { type: "project", key: "alpha" },
      domainPath: null,
    });
    expect(action.input).toEqual({
      content: "Alpha ships in Q2.",
      kind: "fact",
      epistemicStatus: "established",
      validFrom: "2026-10-14T00:00:00Z",
      entities: [{ type: "project", key: "alpha", role: "subject" }],
      domainPaths: [],
    });
  });
});
