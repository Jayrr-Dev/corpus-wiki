import { afterEach, describe, expect, it, vi } from "vitest";
import type { PageReviewSnapshot } from "./pageReview";
import { checkReviewEdits } from "./reviewEditCheck";

// The model is a queue of answers per call name; every request body is kept
function fakeModel(answers: Record<string, unknown[]>) {
  const requests: { name: string; body: { messages: { content: string }[] } }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const name = body.response_format.json_schema.name as string;
    requests.push({ name, body });
    const answer = answers[name]?.shift();
    if (!answer) throw new Error(`No answer queued for ${name}`);
    return new Response(JSON.stringify({ model: "test", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(answer) } }] }));
  }));
  return requests;
}

const snapshot = {
  page: { id: "page", title: "Time Cube", slug: "time-cube" },
  sections: [{ id: "lead", title: "Overview", mode: "generated" }, { id: "site", title: "Website", mode: "generated" }],
  lines: [
    { line_id: "l1", section_id: "lead", content: "Time Cube was a web page Gene Ray set up in 1997.", author: "ai", unit_revision_ids: ["r1"] },
    { line_id: "l2", section_id: "site", content: "Time Cube was a web page Gene Ray set up in 1997.", author: "ai", unit_revision_ids: ["r1"] },
    { line_id: "l3", section_id: "site", content: "The site was one long page. It used undefined jargon.", author: "ai", unit_revision_ids: ["r2", "r3"] },
  ],
  claims: [
    { id: "r1", content: "Time Cube was a personal web page that Gene Ray set up in 1997." },
    { id: "r2", content: "The Time Cube website was one long continuous page." },
    { id: "r3", content: "The Time Cube website used much self-invented jargon, often undefined." },
  ],
  pages: [],
} as PageReviewSnapshot;
const verdict = (ref: string, supported: boolean, extra: { problem?: string; missingCitations?: string[]; unstatedCitations?: string[] } = {}) =>
  ({ ref, problem: extra.problem ?? "", missingCitations: extra.missingCitations ?? [], unstatedCitations: extra.unstatedCitations ?? [], supported });
const edit = (targetId: string, text: string) => ({ type: "revise_line", targetId, text, reason: "r" });

describe("Reviewer edit check", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("drops a rewrite the claims do not support and keeps a supported one as it was", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const requests = fakeModel({
      line_fact_check: [{ lines: [verdict("L1", false, { problem: "attracted considerable attention" }), verdict("L2", true)] }],
      line_fact_confirm: [{ reason: "No claim says this.", lineHasFault: true }],
    });
    const invented = edit("l1", "Time Cube was a web page Gene Ray set up in 1997. It attracted considerable attention.");
    const fine = edit("l3", "The site was one long page that used undefined jargon.");
    const heading = { type: "rename_section", targetId: "site", text: "Website design", reason: "r" };
    const { edits } = await checkReviewEdits({ apiKey: "k", model: "test" }, snapshot, [invented, fine, heading]);
    expect(edits).toEqual([fine, heading]);
    const sent = JSON.parse(requests[0]!.body.messages.at(-1)!.content);
    expect(sent.lines.map((line: { ref: string; claims: { ref: string }[] }) => [line.ref, line.claims.map((claim) => claim.ref)])).toEqual([["L1", ["C1"]], ["L2", ["C2", "C3"]]]);
    expect(sent.sectionClaims.map((claim: { ref: string }) => claim.ref)).toEqual(["C1", "C2", "C3"]);
    expect(warn).toHaveBeenCalledWith("Reviewer edit dropped by the fact-check", expect.objectContaining({ targetId: "l1" }));
    warn.mockRestore();
  });

  it("gives a rewrite the citations of what it now says", async () => {
    fakeModel({
      line_fact_check: [{ lines: [
        verdict("L1", false, { problem: "one long continuous page: C1 does not say this", missingCitations: ["C2"], unstatedCitations: ["C1"] }),
        verdict("L2", true, { unstatedCitations: ["C2"] }),
      ] }],
      line_fact_confirm: [{ reason: "C2 states it.", lineHasFault: false }],
    });
    const moved = edit("l2", "The site was one long continuous page.");
    const trimmed = edit("l3", "It used much self-invented jargon.");
    const { edits } = await checkReviewEdits({ apiKey: "k", model: "test" }, snapshot, [moved, trimmed]);
    expect(edits).toEqual([{ ...moved, unitRevisionIds: ["r2"] }, { ...trimmed, unitRevisionIds: ["r3"] }]);
  });

  it("never removes every citation a line has", async () => {
    fakeModel({ line_fact_check: [{ lines: [verdict("L1", true, { unstatedCitations: ["C1"] })] }] });
    const rewrite = edit("l1", "Gene Ray set up Time Cube in 1997.");
    const { edits } = await checkReviewEdits({ apiKey: "k", model: "test" }, snapshot, [rewrite]);
    expect(edits).toEqual([rewrite]);
  });

  it("passes edits through untouched when the snapshot carries no claims", async () => {
    const requests = fakeModel({});
    const rewrite = edit("l1", "Anything.");
    const { edits } = await checkReviewEdits({ apiKey: "k", model: "test" }, { ...snapshot, claims: [] } as PageReviewSnapshot, [rewrite]);
    expect(edits).toEqual([rewrite]);
    expect(requests).toHaveLength(0);
  });
});
