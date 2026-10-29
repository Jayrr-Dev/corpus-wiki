import { describe, expect, it } from "vitest";
import type { ExistingUnit } from "@/lib/ai/types";
import { pickNeighborhood } from "./neighborhood";
import { buildResolutionMessages, resolveGroup, type ResolutionGroup } from "./resolution";
import type { AnswerClaim } from "./schema";

const claim = (content: string, key = "acme"): AnswerClaim => ({
  action: "add", unit: null, content, title: "Rule", kind: "fact", epistemicStatus: "supported", speechAct: "stated", passages: ["P1"],
  entities: [{ type: "company", key, name: key, role: "subject" }], domainPaths: [], reason: "Read",
});
const unit = (id: string, content: string, key = "acme"): ExistingUnit => ({
  unitId: id, revisionId: `rev-${id}`, content, kind: "fact", epistemicStatus: "supported", sourceDate: "2026-10-01T00:00:00Z", passageIds: [],
  context: { entities: [{ type: "company", key, role: "subject" }], applicability: { status: "unspecified", entities: [], conditions: null } },
});

describe("neighborhood", () => {
  it("puts vector matches, shared-entity claims and earlier upload claims together, most alike first", () => {
    const stored = new Map([unit("a", "Acme checks ladders weekly."), unit("b", "Acme checks ladders and rungs weekly."), unit("c", "Other Co sells ladders.", "other")]
      .map((row) => [row.unitId, row]));
    const neighbors = pickNeighborhood(claim("Acme checks ladders weekly."), null, [{ unitId: "a", similarity: 0.97 }], stored,
      [{ index: 0, claim: claim("Acme checks ladders every week."), vector: null }, { index: 1, claim: claim("Zebras are striped.", "zoo"), vector: null }]);
    expect(neighbors.map((row) => row.kind === "unit" ? row.unit.unitId : `E${row.claim.index}`)).toEqual(["a", "b", "E0"]);
    expect(neighbors.map((row) => row.similarity)).toEqual([...neighbors.map((row) => row.similarity)].sort((x, y) => y - x));
  });
});

describe("resolving a group", () => {
  const stored = unit("a", "Acme checks ladders weekly.");
  const group: ResolutionGroup = { claims: [
    { index: 4, claim: claim("Acme checks ladders weekly."), neighbors: [{ kind: "unit", unit: stored, similarity: 0.99 }] },
    { index: 5, claim: claim("Acme checks ladders daily."), neighbors: [{ kind: "unit", unit: stored, similarity: 0.9 }, { kind: "upload", claim: { index: 1, claim: claim("Acme checks ladders daily."), vector: null }, similarity: 0.95 }] },
    { index: 6, claim: claim("Acme stopped checking ladders."), neighbors: [{ kind: "upload", claim: { index: 1, claim: claim("Acme checks ladders daily."), vector: null }, similarity: 0.6 }] },
  ] };
  const unitRef = (row: ExistingUnit) => (row.unitId === "a" ? "U9" : "U?");
  const claimRef = (index: number) => `C${index + 1}`;

  it("names each neighbor once and lists each claim's neighbors by ref", () => {
    const payload = JSON.parse(buildResolutionMessages({ source: { id: "s", title: "f.md", sourceDate: "2026-11-01T00:00:00Z" } }, group)[1]!.content as string);
    expect(payload.neighbors.map((row: { ref: string }) => row.ref)).toEqual(["U1", "E1"]);
    expect(payload.claims.map((row: { neighbors: string[] }) => row.neighbors)).toEqual([["U1"], ["U1", "E1"], ["E1"]]);
  });

  it("turns decisions into answer claims, merges a repeat of an upload claim and keeps the claim when a decision is unusable", () => {
    const resolved = resolveGroup(group, { decisions: [
      { claim: "C1", decision: "same", target: "U1", reason: "Known." },
      { claim: "C2", decision: "same", target: "E1", reason: "Read earlier." },
      { claim: "C3", decision: "retire", target: "E1", reason: "Only a stored claim can be retired." },
    ], links: [{ from: "C2", to: "U1", type: "related_to", position: null, reason: "x" }, { from: "C3", to: "X7", type: "supports", position: null, reason: "x" }] }, unitRef, claimRef);
    expect(resolved.claims[0]).toEqual({ index: 4, claim: expect.objectContaining({ action: "revise", unit: "U9", content: stored.content, applicability: undefined }) });
    expect(resolved.claims[1]).toEqual({ index: 5, sameAs: 1 });
    expect(resolved.claims[2]).toEqual({ index: 6, claim: expect.objectContaining({ action: "add", unit: null }) });
    // A link from a merged claim follows it to the earlier one; an unknown ref is dropped
    expect(resolved.links).toEqual([{ from: "C2", to: "U9", type: "related_to", position: null, reason: "x" }]);
  });
});
