import { expect, it } from "vitest";
import { claimEmbeddingText, draftTextContext } from "./claimEmbeddingText";

it("puts subjects and scope before the claim and keeps a claim without context bare", () => {
  expect(claimEmbeddingText("Training is required annually", { subjects: ["Acme Inc."], scope: ["Plant 2"], conditions: "new staff" }))
    .toBe("Acme Inc. · Applies to: Plant 2, new staff · Training is required annually");
  expect(claimEmbeddingText("Training is required annually", { subjects: ["Beta LLC"], scope: [], conditions: null }))
    .toBe("Beta LLC · Training is required annually");
  expect(claimEmbeddingText("Water boils at 100 degrees")).toBe("Water boils at 100 degrees");
  // Version 1 (the rollback) is the bare claim whatever its context
  expect(claimEmbeddingText("Training is required annually", { subjects: ["Acme Inc."], scope: [], conditions: null }, 1)).toBe("Training is required annually");
  // Order and repeats never change the text, so stored and drafted claims match
  expect(claimEmbeddingText("X", { subjects: [" Zed ", "Acme", "Acme"], scope: [], conditions: "  " })).toBe("Acme, Zed · X");
});

it("reads a draft's subjects and only scoped applicability, by name", () => {
  const entities = [
    { type: "company", key: "acme", name: "Acme Inc.", role: "subject" },
    { type: "person", key: "jo", name: "Jo", role: "object" },
    { type: "site", key: "hq", name: "HQ", role: "mentioned" },
  ];
  expect(draftTextContext(entities, { status: "scoped", entities: [{ key: "plant-2", name: "Plant 2" }], conditions: "new staff" }))
    .toEqual({ subjects: ["Acme Inc."], scope: ["Plant 2"], conditions: "new staff" });
  expect(draftTextContext(entities, { status: "general", entities: [], conditions: null })).toEqual({ subjects: ["Acme Inc."], scope: [], conditions: null });
  // Without a name (an entity the draft does not name) the key stands in
  expect(draftTextContext([{ key: "acme", role: "subject" }])).toEqual({ subjects: ["acme"], scope: [], conditions: null });
});
