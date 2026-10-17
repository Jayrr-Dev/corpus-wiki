import { afterEach, describe, expect, it, vi } from "vitest";
import { buildReviewBatches } from "./reviewContext";
import { reviewFragments, validateObservation } from "./fragmentReview";

const snapshot = {
  page: { id: "11111111-1111-4111-8111-111111111111", title: "Inspections", slug: "inspections" }, pages: [], sections: [],
  lines: [{ line_id: "22222222-2222-4222-8222-222222222222", author: "ai", content: "Inspections occur monthly.", unit_revision_ids: ["revision"] }],
  claims: [{ id: "revision", content: "Inspections occur weekly.", passage_ids: ["passage"] }],
  passages: [{ id: "passage", source_id: "source", text: "Inspections occur weekly. " + "Additional source detail. ".repeat(900) }],
  sources: [{ id: "source", title: "Safety manual" }],
};
const batches = () => buildReviewBatches(snapshot, [], [], 3000).batches;
const response = (value: unknown) => new Response(JSON.stringify({ model: "fixture-model", choices: [{ message: { content: JSON.stringify(value) }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
const quoteFor = (kind: string) => kind === "lines" ? "Inspections occur monthly." : "Inspections occur weekly.";

// Only the HTTP provider is simulated: production chatJson parses and validates
// every fixture using the real schemas. These are not live-model quality tests.
function provider(mode: "valid" | "fabricated" | "bad-reference" | "bad-schema" | "failure" = "valid") {
  const requests: { name: string; input: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const name = body.response_format.json_schema.name;
    const input = JSON.parse(body.messages.at(-1).content);
    requests.push({ name, input });
    if (name === "page_review_extract") {
      if (mode === "bad-schema") return response({ observations: "not an array" });
      const observations = input.fragments.flatMap((fragment: { kind: string; recordIndex: number; text: string }) => {
        if (!["lines", "claims", "passages"].includes(fragment.kind) || !fragment.text.includes(quoteFor(fragment.kind))) return [];
        return [{ kind: fragment.kind, recordIndex: fragment.recordIndex, quote: mode === "fabricated" ? "Inspections are forbidden." : quoteFor(fragment.kind) }];
      });
      return response({ observations, moreRelevantText: false });
    }
    if (mode === "failure") return new Response("Unavailable", { status: 503 });
    return response({ findings: [{ lineRef: 0, evidenceRefs: [mode === "bad-reference" ? 999 : 0], reason: "The article says monthly; its cited evidence says weekly.", recommendation: "Confirm which inspection schedule applies.", decisionQuestion: "Should the weekly or monthly inspection schedule apply?" }] });
  }));
  return requests;
}
afterEach(() => vi.unstubAllGlobals());

describe("fragment review through the real AI response parser", () => {
  it("consolidates quotations from separate packets and retains the supporting citation", async () => {
    const requests = provider();
    const result = await reviewFragments({ apiKey: "fixture" }, batches(), 3000, 1000);
    expect(requests.filter((request) => request.name === "page_review_extract")).toHaveLength(batches().length);
    const consolidation = requests.find((request) => request.name === "page_review_consolidate");
    expect(consolidation?.input).toMatchObject({ line: { quote: "Inspections occur monthly." }, evidence: expect.arrayContaining([{ ref: 0, kind: "claims", recordId: "revision", quote: "Inspections occur weekly." }]) });
    expect(result.value.edits).toEqual([]);
    expect(result.value.findings).toEqual([expect.objectContaining({ quote: "Inspections occur monthly.", decisionKind: "conflicting_evidence", evidenceReferences: [{ kind: "claims", recordId: "revision", quote: "Inspections occur weekly." }] })]);
    expect(result.tokensIn).toBe(requests.length * 10);
  });
  it.each([
    ["fabricated", "unverified quotation"], ["bad-reference", "unavailable evidence"], ["bad-schema", "invalid claim fields"], ["failure", "Token Factory 503"],
  ] as const)("fails closed for %s provider output", async (mode, error) => {
    provider(mode);
    await expect(reviewFragments({ apiKey: "fixture" }, batches(), 3000, 1000)).rejects.toThrow(error);
  });
  it("does not pair a paragraph with evidence outside its citation chain", async () => {
    const requests = provider();
    const noCitations = { ...snapshot, lines: [{ ...snapshot.lines[0]!, unit_revision_ids: [], content: "Inspections occur monthly. " + "Other text. ".repeat(2000) }] };
    const result = await reviewFragments({ apiKey: "fixture" }, buildReviewBatches(noCitations, [], [], 3000).batches, 3000, 1000);
    expect(result.value.findings).toEqual([]);
    expect(requests.some((request) => request.name === "page_review_consolidate")).toBe(false);
    expect(result.value.summary).toContain("No comparable cited excerpts");
  });
  it("rejects a real quote when it was not visible in the reviewed packet", () => {
    const large = { ...snapshot, lines: [{ ...snapshot.lines[0]!, content: "Start. " + "Filler text. ".repeat(2000) + "Hidden at the end." }] };
    const packet = buildReviewBatches(large, [], [], 3000).batches.find((batch) => {
      const fragments = JSON.parse(batch.evidence).fragments;
      return fragments?.some((fragment: { kind: string; start: number }) => fragment.kind === "lines" && fragment.start === 0);
    })!;
    expect(packet.evidence).not.toContain("Hidden at the end.");
    expect(() => validateObservation({ kind: "lines", recordIndex: 0, quote: "Hidden at the end." }, packet)).toThrow("unverified quotation");
  });
});
