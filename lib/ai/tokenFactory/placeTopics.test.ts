import { describe, expect, it } from "vitest";
import { buildPlaceTopicsMessages, placementActions, readPlacements, type PlaceTopicsInput } from "./placeTopics";

const input: PlaceTopicsInput = {
  sourceTitle: "3.2 Utility Right of Way Process.docx",
  existingPaths: ["EPCOR", "EPCOR/Utility Right of Way"],
  claims: [
    { unitId: "u1", title: "Step 1: title search", content: "The Designer searches the title for a registered URW.", entities: ["EPCOR"] },
    { unitId: "u2", title: "Land Agent negotiates", content: "The Land Agent negotiates the URW location.", entities: ["EPCOR"] },
    { unitId: "u3", title: "URW means Utility Right of Way", content: "URW stands for Utility Right of Way.", entities: [] },
  ],
};

describe("topic placement after cleaning", () => {
  it("shows the model every claim of the file and the existing tree, by short refs only", () => {
    const [, user] = buildPlaceTopicsMessages(input);
    const payload = JSON.parse(user!.content as string);
    expect(payload.existingPaths).toEqual(["EPCOR", "EPCOR/Utility Right of Way"]);
    expect(payload.claims.map((claim: { ref: string }) => claim.ref)).toEqual(["C1", "C2", "C3"]);
    expect(JSON.stringify(payload)).not.toContain("u1");
  });

  it("reuses existing spellings, drops a root repeated under itself and skips unknown refs", () => {
    const placed = readPlacements({ placements: [
      { ref: "C1", domainPaths: ["epcor / utility right of way / URW Application Process"] },
      { ref: "c2", domainPaths: ["EPCOR/EPCOR/Utility Right of Way/URW Application Process"] },
      { ref: "C9", domainPaths: ["Elsewhere"] },
      { ref: "C3", domainPaths: [] },
    ] }, input);
    expect([...placed]).toEqual([
      ["u1", ["EPCOR/Utility Right of Way/URW Application Process"]],
      ["u2", ["EPCOR/Utility Right of Way/URW Application Process"]],
    ]);
  });

  it("creates each new path once, parents first, then places every claim", () => {
    const placed = new Map([
      ["u1", ["EPCOR/Utility Right of Way/URW Application Process"]],
      ["u2", ["EPCOR/Utility Right of Way/URW Application Process", "EPCOR/Land/Agents"]],
    ]);
    const actions = placementActions(placed, input.existingPaths, "Filed with the rest of the file");
    expect(actions.map((action) => action.type === "create_domain" ? `create ${action.input.path}` : `${action.type} ${action.targetId}`)).toEqual([
      "create EPCOR/Land",
      "create EPCOR/Land/Agents",
      "create EPCOR/Utility Right of Way/URW Application Process",
      "place_claim u1",
      "place_claim u2",
    ]);
    expect(actions.at(-1)).toMatchObject({ input: { domainPaths: ["EPCOR/Utility Right of Way/URW Application Process", "EPCOR/Land/Agents"] } });
  });
});
