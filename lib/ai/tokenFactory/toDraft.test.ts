import { describe, expect, it } from "vitest";
import type { ReconciliationInput } from "@/lib/ai/types";
import type { AnswerClaim } from "./schema";
import { answerToActions } from "./toDraft";

// A STORE WITH ONE DECISION AND ONE FILE OF TWO PASSAGES
const INPUT: ReconciliationInput = {
  source: { id: "s2", title: "update.pdf", sourceDate: "2026-09-20T00:00:00Z" },
  passages: [
    { id: "p-a", position: 0, text: "Alpha will use MySQL.", speakerLabel: null },
    { id: "p-b", position: 1, text: "Billing belongs to the finance team.", speakerLabel: null },
  ],
  existingUnits: [
    {
      unitId: "u1", revisionId: "r1", content: "Alpha will use PostgreSQL.", kind: "decision",
      epistemicStatus: "established", sourceDate: "2026-09-01T00:00:00Z", passageIds: ["p-old"],
    },
  ],
  domainPaths: ["Projects", "Projects/Alpha"],
  entities: [{ type: "project", key: "alpha", name: "Project Alpha" }],
};

// A claim with every field filled; tests override what they need
const claim = (overrides: Partial<AnswerClaim>): AnswerClaim => ({
  action: "add", unit: null, content: "x", kind: "fact", epistemicStatus: "supported", speechAct: "stated",
  passages: ["P1"], entities: [], domainPaths: [], reason: "", ...overrides,
});

describe("answerToActions", () => {
  it("turns a changed decision into a revise pinned to the revision the model saw", () => {
    const [action] = answerToActions({ summary: "", claims: [claim({ action: "revise", unit: "U1", content: "Alpha will use MySQL." })] }, INPUT);
    expect(action).toMatchObject({ type: "revise_claim", targetId: "u1", expectedRevisionId: "r1", passageIds: ["p-a"] });
  });

  it("keeps the earlier evidence when the file repeats a unit word for word", () => {
    const [action] = answerToActions({ summary: "", claims: [claim({ action: "revise", unit: "U1", content: "alpha will use  PostgreSQL." })] }, INPUT);
    expect(action).toMatchObject({ passageIds: ["p-old", "p-a"], input: { content: "Alpha will use PostgreSQL." } });
  });

  it("creates new domains (parents first) and new entities before the claim that uses them", () => {
    const entities = [{ type: "Team", key: "Finance Team", name: "Finance team", role: "subject" as const }];
    const actions = answerToActions(
      { summary: "", claims: [claim({ passages: ["P2"], entities, domainPaths: ["Teams/Finance"] })] },
      INPUT,
    );
    expect(actions.map((a) => a.type)).toEqual(["create_domain", "create_domain", "create_entity", "add_claim"]);
    expect(actions[2]?.input).toMatchObject({ type: "team", key: "finance-team" });
  });

  it("drops a claim that cites no real passage", () => {
    expect(answerToActions({ summary: "", claims: [claim({ passages: ["P9"] })] }, INPUT)).toEqual([]);
  });
});

describe("answerToActions links", () => {
  const link = (from: string, to: string, type: "related_to" | "supports" = "related_to") => ({ from, to, type, reason: "" });

  it("puts links last, naming a new claim by its add_claim's position and an existing unit by id", () => {
    const actions = answerToActions(
      { summary: "", claims: [claim({ content: "Billing is owned by finance." })], links: [link("C1", "U1", "supports")] },
      INPUT,
    );
    expect(actions.map((a) => a.type)).toEqual(["add_claim", "link"]);
    expect(actions[1]).toMatchObject({ targetId: null, input: { toUnitId: "u1", type: "supports", fromPosition: 0 } });
  });

  it("links two new claims by position, after the domain and entity creates", () => {
    const actions = answerToActions(
      { summary: "", claims: [claim({ domainPaths: ["Teams"] }), claim({ passages: ["P2"] })], links: [link("C2", "C1")] },
      INPUT,
    );
    expect(actions.map((a) => a.type)).toEqual(["create_domain", "add_claim", "add_claim", "link"]);
    expect(actions[3]).toMatchObject({ targetId: null, input: { toUnitId: null, fromPosition: 2, toPosition: 1 } });
  });

  it("links a revised claim through its existing unit", () => {
    const actions = answerToActions(
      { summary: "", claims: [claim({ action: "revise", unit: "U1", content: "Alpha will use MySQL." }), claim({ passages: ["P2"] })], links: [link("C2", "C1")] },
      INPUT,
    );
    expect(actions.at(-1)).toMatchObject({ type: "link", targetId: null, input: { toUnitId: "u1", fromPosition: 1 } });
  });

  it("drops self links, unknown refs, links to dropped or retired claims, and repeats", () => {
    const actions = answerToActions(
      {
        summary: "",
        claims: [claim({}), claim({ passages: ["P9"] }), claim({ action: "retire", unit: "U1" })],
        links: [link("C1", "C1"), link("C1", "U9"), link("C1", "C2"), link("C1", "C3"), link("C1", "U1"), link("U1", "C1")],
      },
      INPUT,
    );
    // related_to counts both ways, so U1 -> C1 repeats C1 -> U1
    expect(actions.filter((a) => a.type === "link")).toHaveLength(1);
  });

  it("parses older answers without links as having none", () => {
    expect(answerToActions({ summary: "", claims: [claim({})] }, INPUT).map((a) => a.type)).toEqual(["add_claim"]);
  });
});
