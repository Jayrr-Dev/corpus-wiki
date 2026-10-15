import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/ai/chat";
import { buildLinkMessages, type ExistingLink, linkAnswerSchema, linkAnswerToActions, linkBatches, type LinkPassUnit } from "./linkPass";

// THREE UNITS ABOUT ONE POLICY, ONE ALREADY LINKED PAIR
const UNITS: LinkPassUnit[] = [
  { unitId: "u-def", content: "PPE means personal protective equipment.", kind: "definition", domainPaths: ["Health & Safety/PPE"] },
  { unitId: "u-rule", content: "Utilitek workers must wear PPE on site.", kind: "fact", domainPaths: ["Utilitek/Health & Safety/PPE"] },
  { unitId: "u-gloves", content: "Utilitek issues cut-resistant gloves.", kind: "fact", domainPaths: ["Utilitek/Health & Safety/PPE"] },
];
const EXISTING: ExistingLink[] = [{ fromUnitId: "u-rule", toUnitId: "u-gloves", type: "related_to" }];
const link = (from: string, to: string, type: ExistingLink["type"] = "depends_on") => ({ from, to, type, reason: "" });

describe("buildLinkMessages", () => {
  const [system, user] = buildLinkMessages(UNITS, EXISTING) as [ChatMessage, ChatMessage];
  const payload = JSON.parse(user.content);

  it("asks for links only, never changes to units", () => {
    expect(system.role).toBe("system");
    expect(system.content).toContain('{ "links": Link[] }');
    expect(system.content).toContain("never change a unit");
  });

  it("names units by short refs, never by id", () => {
    expect(payload.units).toEqual([
      { ref: "U1", content: "PPE means personal protective equipment.", kind: "definition", domains: ["Health & Safety/PPE"] },
      { ref: "U2", content: "Utilitek workers must wear PPE on site.", kind: "fact", domains: ["Utilitek/Health & Safety/PPE"] },
      { ref: "U3", content: "Utilitek issues cut-resistant gloves.", kind: "fact", domains: ["Utilitek/Health & Safety/PPE"] },
    ]);
    expect(user.content).not.toContain("u-def");
  });

  it("shows the links the batch already has, and leaves out links to units outside it", () => {
    const outside: ExistingLink = { fromUnitId: "u-def", toUnitId: "u-elsewhere", type: "supports" };
    const [, withOutside] = buildLinkMessages(UNITS, [...EXISTING, outside]) as [ChatMessage, ChatMessage];
    expect(JSON.parse(withOutside.content).existingLinks).toEqual([{ from: "U2", to: "U3", type: "related_to" }]);
  });
});

describe("linkAnswerSchema", () => {
  it("rejects a link type the store does not have", () => {
    expect(linkAnswerSchema.safeParse({ links: [link("U1", "U2", "causes" as never)] }).success).toBe(false);
  });
});

describe("linkAnswerToActions", () => {
  it("turns a link into a link action with both unit ids set", () => {
    expect(linkAnswerToActions({ links: [link("U2", "U1")] }, UNITS, [])).toEqual([{
      type: "link",
      targetId: "u-rule",
      expectedRevisionId: null,
      passageIds: [],
      speechAct: null,
      input: { toUnitId: "u-def", type: "depends_on" },
    }]);
  });

  it("reads refs loosely (case and spaces)", () => {
    const [action] = linkAnswerToActions({ links: [link(" u2", "u1 ")] }, UNITS, []);
    expect(action).toMatchObject({ targetId: "u-rule", input: { toUnitId: "u-def" } });
  });

  it("drops unknown refs, claim refs and self links", () => {
    const answer = { links: [link("U9", "U1"), link("C1", "U1"), link("U2", "U2")] };
    expect(linkAnswerToActions(answer, UNITS, [])).toEqual([]);
  });

  it("skips pairs already linked, both ways for symmetric types", () => {
    const answer = { links: [link("U3", "U2", "related_to"), link("U2", "U3", "related_to")] };
    expect(linkAnswerToActions(answer, UNITS, EXISTING)).toEqual([]);
  });

  it("keeps a directed link whose reverse already exists", () => {
    const existing: ExistingLink[] = [{ fromUnitId: "u-rule", toUnitId: "u-def", type: "depends_on" }];
    expect(linkAnswerToActions({ links: [link("U1", "U2")] }, UNITS, existing)).toHaveLength(1);
    expect(linkAnswerToActions({ links: [link("U2", "U1")] }, UNITS, existing)).toHaveLength(0);
  });

  it("keeps one of a repeated link, and different types for the same pair", () => {
    const answer = { links: [link("U2", "U1"), link("U2", "U1"), link("U2", "U1", "related_to")] };
    expect(linkAnswerToActions(answer, UNITS, []).map((a) => a.type === "link" && a.input.type)).toEqual(["depends_on", "related_to"]);
  });
});

describe("linkBatches", () => {
  it("groups units by topic and cuts the list into runs of the given size", () => {
    const units: LinkPassUnit[] = [
      { unitId: "b2", content: "b", kind: "fact", domainPaths: ["B"] },
      { unitId: "none", content: "z", kind: "fact", domainPaths: [] },
      { unitId: "a1", content: "a", kind: "fact", domainPaths: ["A/x", "C"] },
      { unitId: "b1", content: "a", kind: "fact", domainPaths: ["B"] },
    ];
    expect(linkBatches(units, 3).map((batch) => batch.map((u) => u.unitId))).toEqual([["a1", "b1", "b2"], ["none"]]);
  });
});
