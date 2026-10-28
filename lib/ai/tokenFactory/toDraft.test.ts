import { describe, expect, it } from "vitest";
import type { ReconciliationInput } from "@/lib/ai/types";
import type { AnswerClaim, AnswerEntityRef } from "./schema";
import { buildReconciliationMessages } from "./prompt";
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

// A type word as an answer that skipped parsing may carry it (parsing maps it onto the list)
const loose = (type: string) => type as AnswerEntityRef["type"];

// A claim with every field filled; tests override what they need
const claim = (overrides: Partial<AnswerClaim>): AnswerClaim => ({
  action: "add", unit: null, content: "x", title: "", kind: "fact", epistemicStatus: "supported", speechAct: "stated",
  passages: ["P1"], entities: [], domainPaths: [], reason: "", ...overrides,
});

describe("answerToActions", () => {
  it("gives reconciliation existing structured context", () => {
    const context = { entities: [{ type: "project", key: "alpha", role: "subject" as const }], applicability: { status: "scoped" as const, entities: [{ type: "project", key: "alpha" }], conditions: null } };
    const messages = buildReconciliationMessages({ ...INPUT, existingUnits: [{ ...INPUT.existingUnits[0]!, context }] });
    expect(JSON.parse(messages[1]!.content).existingUnits[0].context).toEqual(context);
    expect(messages[0]!.content).toContain("Two people sharing a name are not automatically identical");
    expect(messages[0]!.content).toContain("stakeholderLinks");
    expect(messages[0]!.content).toContain("owned_by (a person or organization owns it");
    expect(messages[0]!.content).toContain("vice_president: Vice president");
    expect(messages[0]!.content).toContain("never guess a date");
  });

  it("preserves legacy revision context and carries explicit context corrections", () => {
    const legacy = answerToActions({ summary: "", claims: [claim({ action: "revise", unit: "U1" })] }, INPUT);
    expect(legacy[0]?.input).not.toHaveProperty("context");
    const actions = answerToActions({ summary: "", claims: [claim({ action: "revise", unit: "U1", entities: [{ type: "person", key: "alex-alpha", name: "Alex", role: "subject" }], applicability: { status: "scoped", entities: [{ type: "project", key: "alpha", name: "Alpha" }], conditions: "during the project" } })] }, INPUT);
    expect(actions.map(a => a.type)).toEqual(["create_entity", "revise_claim"]);
    expect(actions[1]?.input).toMatchObject({ context: { entities: [{ type: "person", key: "alex-alpha", role: "subject" }], applicability: { status: "scoped", entities: [{ type: "project", key: "alpha" }], conditions: "during the project" } } });
  });

  it("keeps listed types as they are and maps stray ones onto the list", () => {
    const actions = answerToActions({ summary: "", claims: [claim({ entities: [
      { type: "government_body", key: "Health Canada", name: "Health Canada", role: "subject" },
      { type: loose("law"), key: "hazardous-products-act", name: "Hazardous Products Act", role: "object" },
    ] })] }, INPUT);
    expect(actions.filter((a) => a.type === "create_entity").map((a) => [a.input.type, a.input.key])).toEqual([
      ["government_body", "health-canada"], ["legislation", "hazardous-products-act"],
    ]);
    expect(actions.at(-1)?.input).toMatchObject({ context: { entities: expect.arrayContaining([{ type: "government_body", key: "health-canada", role: "subject" }]) } });
  });

  it("keeps the claim's structure labels in its context, dropping ones whose ends are not its entities", () => {
    const seat = { title: null, seniority: null, share: null, current: true, since: null, until: null };
    const actions = answerToActions({ summary: "", claims: [claim({
      entities: [
        { type: "person", key: "dana-lee", name: "Dana Lee", role: "subject" },
        { type: "team", key: "billing", name: "Billing", role: "object" },
        { type: "company", key: "Acme Corp", name: "Acme Corp", role: "mentioned" },
      ],
      applicability: { status: "unspecified", entities: [], conditions: null },
      stakeholderLinks: [
        { ...seat, from: { type: "person", key: "dana-lee" }, link: "leads", to: { type: "team", key: "billing" }, title: " Head of Billing ", seniority: "director", share: 0.5 },
        { ...seat, from: { type: "team", key: "billing" }, link: "part_of", to: { type: "company", key: "Acme Corp" } },
        { ...seat, from: { type: "company", key: "acme-corp" }, link: "owned_by", to: { type: "company", key: "globex" }, share: 0.6 },
        { ...seat, from: { type: "team", key: "billing" }, link: "part_of", to: { type: "team", key: "billing" } },
      ],
    })] }, INPUT);
    expect(actions.at(-1)?.input).toMatchObject({ context: { structure: [
      { ...seat, from: { type: "person", key: "dana-lee" }, link: "leads", to: { type: "team", key: "billing" }, title: "Head of Billing", seniority: "director" },
      { ...seat, from: { type: "team", key: "billing" }, link: "part_of", to: { type: "company", key: "acme-corp" } },
    ] } });
  });

  it("writes no structure key for a claim without labels, and carries labels on a revision", () => {
    const plain = answerToActions({ summary: "", claims: [claim({ applicability: { status: "unspecified", entities: [], conditions: null } })] }, INPUT);
    expect(plain.at(-1)?.input).not.toHaveProperty("context.structure");
    const label = { from: { type: "person" as const, key: "dana-lee" }, link: "works_in" as const, to: { type: "project" as const, key: "alpha" }, title: null, seniority: "staff" as const, share: null, current: false, since: "2019", until: null };
    const revised = answerToActions({ summary: "", claims: [claim({ action: "revise", unit: "U1",
      entities: [{ type: "person", key: "dana-lee", name: "Dana Lee", role: "subject" }, { type: "project", key: "alpha", name: "Project Alpha", role: "object" }],
      applicability: { status: "unspecified", entities: [], conditions: null }, stakeholderLinks: [label] })] }, INPUT);
    expect(revised.at(-1)).toMatchObject({ type: "revise_claim", input: { context: { structure: [label] } } });
  });

  it("keeps stated partial dates, drops malformed ones, and treats an end date as not current", () => {
    const entities = [{ type: "person" as const, key: "dana-lee", name: "Dana Lee", role: "subject" as const }, { type: "team" as const, key: "billing", name: "Billing", role: "object" as const }];
    const label = (since: string | null, until: string | null) => ({ from: { type: "person" as const, key: "dana-lee" }, link: "works_in" as const,
      to: { type: "team" as const, key: "billing" }, title: null, seniority: null, share: null, current: true, since, until });
    const structureOf = (since: string | null, until: string | null) => {
      const actions = answerToActions({ summary: "", claims: [claim({ entities, applicability: { status: "unspecified", entities: [], conditions: null }, stakeholderLinks: [label(since, until)] })] }, INPUT);
      const input = actions.at(-1)?.input as { context: { structure: { since: string | null; until: string | null; current: boolean }[] } };
      return input.context.structure[0];
    };
    expect(structureOf("2019", "2021-03")).toMatchObject({ since: "2019", until: "2021-03", current: false });
    expect(structureOf(" 2021-03-15 ", null)).toMatchObject({ since: "2021-03-15", until: null, current: true });
    expect(structureOf("March 2021", "2021/03")).toMatchObject({ since: null, until: null, current: true });
  });

  it("creates scope-only entities before a claim without treating them as subjects", () => {
    const actions = answerToActions({ summary: "", claims: [claim({ applicability: { status: "scoped", entities: [{ type: "company", key: "acme", name: "Acme" }], conditions: "employees" } })] }, INPUT);
    expect(actions.map(a => a.type)).toEqual(["create_entity", "add_claim"]);
    expect(actions[1]?.input).toMatchObject({ entities: [], context: { applicability: { entities: [{ type: "company", key: "acme" }] } } });
  });

  it("preserves explicit conditions when a model mislabels their applicability", () => {
    const actions = answerToActions({ summary: "", claims: [claim({ applicability: { status: "general", entities: [], conditions: "in Canadian workplaces" } })] }, INPUT);
    expect(actions.at(-1)?.input).toMatchObject({ context: { applicability: { status: "scoped", conditions: "in Canadian workplaces" } } });
  });
  it("does not collapse same-text revisions with different applicability", () => {
    const actions = answerToActions({ summary: "", claims: ["onsite", "remote"].map(conditions => claim({ action: "revise", unit: "U1", applicability: { status: "scoped", entities: [], conditions } })) }, INPUT);
    expect(actions.map(a => a.type)).toEqual(["revise_claim", "add_claim"]);
  });

  it("keeps different revisions from later batches available to the duplicate guard", () => {
    const actions = answerToActions({ summary: "", claims: [
      claim({ action: "revise", unit: "U1", content: "Alpha will use MySQL." }),
      claim({ action: "revise", unit: "U1", content: "Alpha will use MySQL with daily backups.", passages: ["P2"] }),
    ] }, INPUT);
    expect(actions.map((action) => action.type)).toEqual(["revise_claim", "add_claim"]);
    expect(actions[1]).toMatchObject({ passageIds: ["p-b"], input: { content: "Alpha will use MySQL with daily backups." } });
  });

  it("unions evidence when several batches revise to the same wording", () => {
    const actions = answerToActions({ summary: "", claims: [
      claim({ action: "revise", unit: "U1", content: "Alpha will use MySQL." }),
      claim({ action: "revise", unit: "U1", content: "Alpha will use MySQL.", passages: ["P2"] }),
    ] }, INPUT);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.passageIds).toEqual(["p-a", "p-b"]);
  });

  it("rejects partial citation sets instead of saving a partially supported claim", () => {
    expect(() => answerToActions({ summary: "", claims: [claim({ passages: ["P1", "P99"] })] }, INPUT)).toThrow("unknown passage");
  });
  it("reuses established company and topic branches instead of creating spelling duplicates", () => {
    const path = "Utilitek Solutions Inc./Health & Safety/Inspections";
    const actions = answerToActions({ summary: "", claims: [claim({ domainPaths: ["utilitek solutions inc/Health and Safety/Quality Inspection"] })] }, { ...INPUT, domainPaths: ["Utilitek Solutions Inc.", "Utilitek Solutions Inc./Health & Safety", path] });
    expect(actions.map((action) => action.type)).toEqual(["add_claim"]);
    expect(actions[0]?.input).toMatchObject({ domainPaths: [path] });
  });
  it("turns a changed decision into a revise pinned to the revision the model saw", () => {
    const [action] = answerToActions({ summary: "", claims: [claim({ action: "revise", unit: "U1", content: "Alpha will use MySQL." })] }, INPUT);
    expect(action).toMatchObject({ type: "revise_claim", targetId: "u1", expectedRevisionId: "r1", passageIds: ["p-a"] });
  });

  it("carries the claim's title on adds and revises, and leaves it out when there is none", () => {
    const [add] = answerToActions({ summary: "", claims: [claim({ title: " Billing owner ", content: "Billing belongs to finance." })] }, INPUT);
    expect(add).toMatchObject({ type: "add_claim", input: { title: "Billing owner" } });
    const [revise] = answerToActions({ summary: "", claims: [claim({ action: "revise", unit: "U1", content: "Alpha will use MySQL." })] }, INPUT);
    expect(revise!.input).not.toHaveProperty("title");
  });

  it("keeps the earlier evidence when the file repeats a unit word for word", () => {
    const [action] = answerToActions({ summary: "", claims: [claim({ action: "revise", unit: "U1", content: "alpha will use  PostgreSQL." })] }, INPUT);
    expect(action).toMatchObject({ passageIds: ["p-old", "p-a"], input: { content: "Alpha will use PostgreSQL." } });
  });

  it("creates new domains (parents first) and new entities before the claim that uses them", () => {
    const entities = [{ type: loose("Team"), key: "Finance Team", name: "Finance team", role: "subject" as const }];
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

describe("composites", () => {
  const sequence = { type: "sequence" as const, complete: true, mode: null };
  const step = (from: string, position: number | null, to = "C1") => ({ from, to, type: "part_of" as const, position, reason: "" });

  it("adds a sequence with its steps renumbered 1..n in the file's order", () => {
    const actions = answerToActions({ summary: "", claims: [
      claim({ content: "Alpha deploys in three steps", kind: "procedure", structure: sequence }),
      claim({ content: "Alpha builds" }), claim({ content: "Alpha tests" }), claim({ content: "Alpha ships" }),
    ], links: [step("C2", 2), step("C3", 5), step("C4", 9)] }, INPUT);
    expect(actions.map((a) => a.type)).toEqual(["add_claim", "add_claim", "add_claim", "add_claim", "link", "link", "link"]);
    expect(actions[0]?.input).toMatchObject({ structure: sequence });
    expect(actions.slice(4).map((a) => a.type === "link" && a.input.memberPosition)).toEqual([1, 2, 3]);
  });

  it("drops positions on a set and on links that are not part_of, and a set keeps its mode", () => {
    const actions = answerToActions({ summary: "", claims: [
      claim({ content: "Alpha's kit is a helmet and gloves", structure: { type: "set", complete: true, mode: "all" } }),
      claim({ content: "Alpha's kit includes a helmet" }), claim({ content: "Alpha checks the kit" }),
    ], links: [step("C2", 1), { from: "C3", to: "C1", type: "depends_on", position: 2, reason: "" }] }, INPUT);
    expect(actions[0]?.input).toMatchObject({ structure: { type: "set", complete: true, mode: "all" } });
    expect(actions.filter((a) => a.type === "link").map((a) => a.input)).toEqual([
      expect.not.objectContaining({ memberPosition: expect.anything() }),
      expect.not.objectContaining({ memberPosition: expect.anything() }),
    ]);
  });

  it("moves a known step with set_member and leaves a step in place alone", () => {
    const procedure = { unitId: "u-proc", revisionId: "r-proc", content: "Alpha deploys in two steps", kind: "procedure" as const, epistemicStatus: "established" as const, sourceDate: "2026-09-01T00:00:00Z", passageIds: [], structure: sequence, memberUnitIds: ["u-build", "u-ship"] };
    const member = (unitId: string, content: string) => ({ unitId, revisionId: `r-${unitId}`, content, kind: "procedure" as const, epistemicStatus: "established" as const, sourceDate: "2026-09-01T00:00:00Z", passageIds: [] });
    const input = { ...INPUT, existingUnits: [procedure, member("u-build", "Alpha builds"), member("u-ship", "Alpha ships")] };
    const messages = buildReconciliationMessages(input);
    expect(JSON.parse(messages[1]!.content).existingUnits[0]).toMatchObject({ structure: sequence, members: ["U2", "U3"] });
    const actions = answerToActions({ summary: "", claims: [
      claim({ action: "revise", unit: "U2", content: "Alpha builds" }), claim({ action: "revise", unit: "U3", content: "Alpha ships" }),
    ], links: [step("C1", 2, "U1"), step("C2", 2, "U1")] }, input);
    expect(actions.filter((a) => a.type === "set_member")).toEqual([
      expect.objectContaining({ targetId: "u-proc", input: expect.objectContaining({ memberUnitId: "u-build", position: 2 }) }),
    ]);
    expect(actions.some((a) => a.type === "link")).toBe(false);
  });
});

describe("a composite over steps the store already has", () => {
  it("adds the composite and links the existing units to it in order", () => {
    const step = (unitId: string, content: string) => ({ unitId, revisionId: `r-${unitId}`, content, kind: "procedure" as const, epistemicStatus: "established" as const, sourceDate: "2026-09-01T00:00:00Z", passageIds: [] });
    const input = { ...INPUT, existingUnits: [step("u-build", "Alpha builds"), step("u-ship", "Alpha ships")] };
    const actions = answerToActions({ summary: "", claims: [
      claim({ content: "Alpha deploys in two steps", kind: "procedure", structure: { type: "sequence", complete: true, mode: null } }),
    ], links: [{ from: "U2", to: "C1", type: "part_of", position: 2, reason: "" }, { from: "U1", to: "C1", type: "part_of", position: 1, reason: "" }] }, input);
    expect(actions.filter((a) => a.type === "link").map((a) => a.type === "link" && [a.targetId, a.input.toPosition, a.input.memberPosition])).toEqual([["u-ship", 0, 2], ["u-build", 0, 1]]);
  });
});

describe("composites from a model that leaves positions out", () => {
  it("numbers the steps in the order the links were listed and drops step-to-step chains", () => {
    const sequence = { type: "sequence" as const, complete: true, mode: null };
    const actions = answerToActions({ summary: "", claims: [
      claim({ content: "Alpha deploys in three steps", kind: "procedure", structure: sequence }),
      claim({ content: "Alpha builds" }), claim({ content: "Alpha tests" }), claim({ content: "Alpha ships" }),
    ], links: [
      { from: "C2", to: "C1", type: "part_of", reason: "" }, { from: "C3", to: "C1", type: "part_of", reason: "" }, { from: "C4", to: "C1", type: "part_of", reason: "" },
      { from: "C2", to: "C3", type: "part_of", reason: "" }, { from: "C3", to: "C4", type: "part_of", reason: "" },
    ] }, INPUT);
    const links = actions.filter((a) => a.type === "link");
    expect(links.map((a) => a.type === "link" && [a.input.fromPosition, a.input.toPosition, a.input.memberPosition])).toEqual([[1, 0, 1], [2, 0, 2], [3, 0, 3]]);
  });
});

describe("a first step linked backwards", () => {
  it("turns the link round and keeps the step first", () => {
    const sequence = { type: "sequence" as const, complete: true, mode: null };
    const actions = answerToActions({ summary: "", claims: [
      claim({ content: "Alpha deploys in three steps", kind: "procedure", structure: sequence }),
      claim({ content: "Alpha builds" }), claim({ content: "Alpha tests" }), claim({ content: "Alpha ships" }),
    ], links: [
      { from: "C1", to: "C2", type: "part_of", position: null, reason: "" },
      { from: "C3", to: "C1", type: "part_of", position: 1, reason: "" },
      { from: "C4", to: "C1", type: "part_of", position: 2, reason: "" },
    ] }, INPUT);
    const links = actions.filter((a) => a.type === "link");
    expect(links.map((a) => a.type === "link" && [a.input.fromPosition, a.input.toPosition, a.input.memberPosition])).toEqual([[1, 0, 1], [2, 0, 2], [3, 0, 3]]);
  });
});
