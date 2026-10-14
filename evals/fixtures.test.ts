import { describe, expect, it } from "vitest";
import { Constants } from "@/lib/database/types";
import { FakeReconciliationClient } from "@/lib/ai";
import { CANNED_CLAIMS } from "@/lib/ai/fake/canned";
import { EVAL_CASES, FIXTURES, type FixtureFile } from "./cases";
import { readFixture } from "./harness";

const ALL_FIXTURES: FixtureFile[] = Object.values(FIXTURES);

// The date written on a fixture's first line ("Date: YYYY-MM-DD")
function headerDate(fixture: FixtureFile): string | undefined {
  return /^Date: (\d{4}-\d{2}-\d{2})/.exec(readFixture(fixture))?.[1];
}

// Fake input for one file, as agent C will build it (one passage per paragraph)
function inputFor(fixture: FixtureFile) {
  const paragraphs = readFixture(fixture).split(/\n\s*\n/).filter(Boolean);
  return {
    source: { id: "source-1", title: fixture.file, sourceDate: `${fixture.date}T00:00:00Z` },
    passages: paragraphs.map((text, position) => ({ id: `p${position}`, position, text, speakerLabel: null })),
    existingUnits: [],
    domainPaths: [],
    entities: [],
  };
}

describe("eval fixtures", () => {
  it("covers E1 to E7", () => {
    expect(EVAL_CASES.map((c) => c.id)).toEqual(["E1", "E2", "E3", "E4", "E5", "E6", "E7"]);
  });

  it.each(ALL_FIXTURES)("$file carries the date listed in cases.ts", (fixture) => {
    expect(headerDate(fixture)).toBe(fixture.date);
  });

  it.each(ALL_FIXTURES)("$file has a canned answer in the fake client", (fixture) => {
    expect(CANNED_CLAIMS[fixture.file]).toBeDefined();
  });
});

describe("FakeReconciliationClient", () => {
  const client = new FakeReconciliationClient();

  it.each(ALL_FIXTURES)("drafts valid typed actions for $file", async (fixture) => {
    const draft = await client.draftChangeSet(inputFor(fixture));
    expect(draft.actions.length).toBeGreaterThan(0);
    for (const action of draft.actions) {
      expect(Constants.public.Enums.action_type).toContain(action.type);
      expect(action.passageIds.length).toBeGreaterThan(0);
    }
  });

  it("adds a hypothesis, not a decision, for the E4 meeting notes", async () => {
    const draft = await client.draftChangeSet(inputFor(FIXTURES.e4));
    const [action] = draft.actions;
    expect(action?.type).toBe("add_claim");
    if (action?.type !== "add_claim") return;
    expect(action.input.epistemicStatus).toBe("hypothesis");
    expect(action.input.kind).not.toBe("decision");
  });

  it("revises the existing database decision for E2", async () => {
    const existingUnits = [
      {
        unitId: "u1",
        revisionId: "r1",
        content: "Alpha will use PostgreSQL.",
        kind: "decision" as const,
        epistemicStatus: "established" as const,
        sourceDate: "2026-09-01T00:00:00Z",
        passageIds: ["old"],
      },
    ];
    const draft = await client.draftChangeSet({ ...inputFor(FIXTURES.e2), existingUnits });
    expect(draft.actions[0]).toMatchObject({ type: "revise_claim", targetId: "u1", expectedRevisionId: "r1" });
    expect(draft.actions[0]?.passageIds).not.toContain("old");
  });

  it("returns an empty ChangeSet for an unknown file", async () => {
    const draft = await client.draftChangeSet({ ...inputFor(FIXTURES.e1), source: { id: "s", title: "other.md", sourceDate: "" } });
    expect(draft.actions).toEqual([]);
  });
});
