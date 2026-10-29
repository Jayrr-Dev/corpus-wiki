import { roleForPurpose } from "@/lib/ai/roles";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SectionReviseInput, SectionUnit } from "../types";
import { changedCharacters, EDITORIAL_MIN_CHANGE, TokenFactorySectionWriter } from "./tokenFactory";

// =====================================================================
// REVIEWER CALLS PER SECTION (issue #42): builds whole sections with a
// fake model that streams the draft in small pieces, as a real one does,
// and counts the calls that run on the Reviewer's model. The fake reads
// each request and answers it, so the count does not depend on how many
// answers were queued.
// =====================================================================

type Line = { text: string; claims: string[] };
const UNITS = ["a", "b", "c", "d"].map((id, index): SectionUnit => ({ unitId: id, revisionId: `${id}-r`, content: `Claim ${index + 1} about the subject.`, kind: "fact", epistemicStatus: "established" }));
const INPUT: SectionReviseInput = {
  pageTitle: "Subject", sectionTitle: "Details", lines: [], uncoveredUnitIds: UNITS.map((unit) => unit.unitId), units: UNITS,
  pageContext: [{ section: "Overview", text: "Subject is a thing." }],
};
const line = (n: number, extra = ""): Line => ({ text: `Paragraph ${n} states claim ${n} about the subject.${extra}`, claims: [`C${n}`] });
const GOOD = [1, 2, 3, 4].map((n) => line(n));
const WITH_FAULTS = [line(1), line(2, " It was founded in 1901."), line(3), line(4, " It won an award.")];

// Every request by name; `faulty` lines fail the fact-check and the second opinion upholds it.
// A draft is the new lines of a section, or a whole patch answer for a section that has lines.
function fakeModel(drafts: (Line[] | { revise: unknown[]; retire: string[]; add: Line[] })[], faulty: (text: string) => boolean) {
  const names: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { stream?: boolean; response_format: { json_schema: { name: string } }; messages: { content: string }[] };
    const name = body.response_format.json_schema.name;
    names.push(name);
    // The writer's repair request is prose; only the reviewer calls need their request read
    const sent = (name === "section_lines" ? {} : JSON.parse(body.messages.at(-1)!.content)) as { lines?: { ref: string; text: string }[]; objections?: { ref: string; line: string }[] };
    const draft = name === "section_lines" ? drafts.shift() : undefined;
    const answer = name === "section_lines" ? (Array.isArray(draft) ? { revise: [], retire: [], add: draft } : draft)
      : name === "line_fact_check" ? { lines: sent.lines!.map(({ ref, text }) => ({ ref, problem: faulty(text) ? "Adds a fact." : "", missingCitations: [], unstatedCitations: [], supported: !faulty(text) })) }
      // Answers both the one-objection and the batched shape, so the same fake also counts the old code
      : name === "line_fact_confirm" ? { reason: "The claims do not say this.", lineHasFault: true, opinions: (sent.objections ?? []).map(({ ref }) => ({ ref, reason: "The claims do not say this.", lineHasFault: true })) }
      : name === "independent_section_editorial_selection" ? { omit: [] }
      : name === "independent_section_editorial_review" ? { issues: [] }
      : null;
    if (!answer) throw new Error(`Unexpected call ${name} after ${names.join(", ")}: ${body.messages.at(-1)!.content.slice(0, 300)}`);
    const content = JSON.stringify(answer);
    if (!body.stream) return new Response(JSON.stringify({ model: "test", usage: { prompt_tokens: 10, completion_tokens: 5 }, choices: [{ finish_reason: "stop", message: { content } }] }));
    // The draft arrives 24 characters at a time, so finished lines show up before the answer ends
    const pieces = content.match(/[\s\S]{1,24}/g)!;
    const events = pieces.map((piece, index) => `data: ${JSON.stringify({ model: "test", choices: [{ delta: { content: piece }, finish_reason: index === pieces.length - 1 ? "stop" : null }], ...(index === pieces.length - 1 ? { usage: { prompt_tokens: 10, completion_tokens: 5 } } : {}) })}\n\n`);
    return new Response(`${events.join("")}data: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
  }));
  return names;
}

const reviewerCalls = (names: string[]) => names.filter((name) => roleForPurpose(name) === "reviewer");
const count = (names: string[], name: string) => names.filter((item) => item === name).length;

describe("reviewer calls per section built", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("checks a clean four-line section in one fact-check call", async () => {
    const names = fakeModel([GOOD], () => false);
    const revision = await new TokenFactorySectionWriter({ apiKey: "k", model: "test" }).reviseSection(INPUT);
    expect(revision.add).toHaveLength(4);
    expect(count(names, "line_fact_check")).toBe(1);
    // Editorial selection, one fact-check and one editorial review
    expect(reviewerCalls(names)).toHaveLength(3);
  });

  it("confirms every objection of a draft in one call, then rechecks the repair in one call", async () => {
    const names = fakeModel([WITH_FAULTS, GOOD], (text) => text.includes("1901") || text.includes("award"));
    const revision = await new TokenFactorySectionWriter({ apiKey: "k", model: "test" }).reviseSection(INPUT);
    expect(revision.add.map((item) => item.text)).toEqual(GOOD.map((item) => item.text));
    expect(count(names, "line_fact_check")).toBe(2);
    expect(count(names, "line_fact_confirm")).toBe(1);
    // Selection, then per draft one fact-check and one editorial review, plus one confirm for the first draft
    expect(reviewerCalls(names)).toHaveLength(6);
  });

  // A section that already has lines, refreshed after one claim changed
  const OLD = "Paragraph 1 states claim 1 about the subject, which was revised later.";
  const EXISTING: SectionReviseInput = {
    ...INPUT, units: [UNITS[0]!], uncoveredUnitIds: [],
    lines: [{ lineId: "l1", lineRevisionId: "lr1", position: 0, content: OLD, author: "ai", unitIds: ["a"], needsRewrite: true }],
  };
  const patch = (old_str: string, new_str: string) => ({ revise: [{ line: "L1", patches: [{ old_str, new_str }], claims: ["C1"] }], retire: [], add: [] });

  it("skips the editorial review when a rewrite changes only a few characters", async () => {
    const names = fakeModel([patch("revised", "changed")], () => false);
    const revision = await new TokenFactorySectionWriter({ apiKey: "k", model: "test" }).reviseSection(EXISTING);
    expect(revision.revise[0]?.text).toContain("changed later");
    expect(count(names, "independent_section_editorial_review")).toBe(0);
    expect(count(names, "line_fact_check")).toBe(1);
  });

  it("still reviews a rewrite that adds a new sentence", async () => {
    const names = fakeModel([patch("later.", "later. The subject then moved to a new home in another city.")], () => false);
    await new TokenFactorySectionWriter({ apiKey: "k", model: "test" }).reviseSection(EXISTING);
    expect(count(names, "independent_section_editorial_review")).toBe(1);
  });
});

describe("how much a rewrite changed", () => {
  it("counts only the characters between the shared start and end", () => {
    expect(changedCharacters("Founded in 2020.", "Founded in 2021.")).toBe(1);
    expect(changedCharacters("Same text.", "Same text.")).toBe(0);
    expect(changedCharacters("It grew.", "It grew. It then moved to a new home in another city.")).toBeGreaterThanOrEqual(EDITORIAL_MIN_CHANGE);
    expect(changedCharacters("aa", "aaa")).toBe(1);
  });
});
