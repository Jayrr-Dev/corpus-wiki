import { expect, it } from "vitest";
import { clusterEvidence, visibleSimilarityConnections, validateDecisionCoverage, validatePlacementSequence, independentIdeas, type DecisionSnapshot } from "./decider";
import type { GraphData, GraphNode } from "@/lib/graph/types";
it("uses vectors and typed graph links while preserving full claim evidence", () => {
  const snapshot: DecisionSnapshot = { domains: [{ id: "d", name: "Root", path: "Root", parent_id: null, retired_at: null, context_entity_id: null }],
    claims: Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, revisionId: `r${i}`, content: `Claim ${i}`, retiredAt: null })),
    unitDomains: Array.from({ length: 10 }, (_, i) => ({ unit_id: `c${i}`, domain_id: "d" })),
  };
  const evidence = clusterEvidence(snapshot, new Map(snapshot.claims.map(c => [c.revisionId, [1, 0]])), [{ from: "c0", to: "c1", type: "supports" }]);
  expect(evidence.clusters).toHaveLength(1);
  expect(evidence.clusters[0]!.claims).toHaveLength(10);
  expect(evidence.clusters[0]!.claims[0]!.text).toBe("Claim 0");
  expect(evidence.clusters[0]!.connections.internal).toBe(1);
  expect(evidence.clusters[0]!.connections.edges).toEqual([["C1", "supports", "C2"]]);
  expect(JSON.stringify(evidence)).not.toContain('"seed"');
  expect(() => clusterEvidence(snapshot, new Map())).toThrow("no embeddings");
});

it("catches a repeated move from an emptied source before a database write and accepts ordered cross-filing", () => {
  const snapshot: DecisionSnapshot = { domains: [{ id: "d", name: "Root", path: "Root", parent_id: null, retired_at: null, context_entity_id: null }],
    claims: [{ id: "c", revisionId: "r", content: "Equipment used during a procedure", retiredAt: null }], unitDomains: [{ unit_id: "c", domain_id: "d" }] };
  const operations = [
    { operation: "create" as const, sourcePath: null, destinationPath: "Root", name: "Equipment", claimIds: [] },
    { operation: "create" as const, sourcePath: null, destinationPath: "Root", name: "Steps", claimIds: [] },
    { operation: "assign" as const, sourcePath: "Root", destinationPath: "Root/Equipment", name: null, claimIds: ["C1"] },
    { operation: "cross_file" as const, sourcePath: "Root", destinationPath: "Root/Steps", name: null, claimIds: ["C1"] },
  ];
  const review = { assessments: [], candidateDecisions: [], confident: true, reason: "File equipment", operations };
  expect(() => validatePlacementSequence(review, snapshot)).toThrow("no longer in Root");
  expect(() => validatePlacementSequence({ ...review, operations: operations.map((op, i) => i === 3 ? { ...op, sourcePath: "Root/Equipment" } : op) }, snapshot)).not.toThrow();
  expect(snapshot.unitDomains).toEqual([{ unit_id: "c", domain_id: "d" }]);
});

it("counts repeated wording conservatively without collapsing numeric differences or removing evidence", () => {
  const claims = ["Workers must wear hearing protection at 85 dB.", "Workers must wear hearing protection at 85 dB!", "Workers must wear hearing protection at 90 dB."]
    .map((content, i) => ({ id: `c${i}`, revisionId: `r${i}`, content, retiredAt: null }));
  const vectors = new Map(claims.map(c => [c.revisionId, [1,0]]));
  expect(independentIdeas(claims, vectors).map(g => g.length)).toEqual([2,1]);
  expect(claims).toHaveLength(3);
});

it("rejects catch-all and redundant process levels while permitting meaningful procedure structure", () => {
  const review = { assessments: [], candidateDecisions: [], confident: true, reason: "Organize", operations: [{ operation: "create" as const, sourcePath: null, destinationPath: "Company/Application Process", name: "Process Steps", claimIds: [] }] };
  const context = { mustReview: [], candidates: [] };
  expect(() => validateDecisionCoverage(review, context)).toThrow("redundant procedure level");
  expect(() => validateDecisionCoverage({ ...review, operations: [{ ...review.operations[0]!, name: null }] }, context)).toThrow("nonempty name");
  expect(() => validateDecisionCoverage({ ...review, operations: [{ ...review.operations[0]!, name: "Definitions" }] }, context)).toThrow("catch-all domain");
  expect(() => validateDecisionCoverage({ ...review, operations: [{ ...review.operations[0]!, destinationPath: "Company/Confined Space Entry", name: "Procedure Steps" }] }, context)).not.toThrow();
});

it("requires review of small residual parent groups even below the old twelve-claim cutoff", () => {
  const snapshot: DecisionSnapshot = { domains: [
    { id: "parent", name: "Entry", path: "Company/Entry", parent_id: null, retired_at: null, context_entity_id: null },
    { id: "child", name: "Steps", path: "Company/Entry/Steps", parent_id: "parent", retired_at: null, context_entity_id: null },
  ], claims: Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, revisionId: `r${i}`, content: `Requirement ${i}`, retiredAt: null })),
    unitDomains: Array.from({ length: 5 }, (_, i) => ({ unit_id: `c${i}`, domain_id: "parent" })),
  };
  const context = clusterEvidence(snapshot, new Map(snapshot.claims.map(c => [c.revisionId, [1, 0]])));
  expect(context.mustReview).toContain("Company/Entry");
  expect(context.candidates[0]).toMatchObject({ kind: "unfiled_parent_group", claims: ["C1", "C2", "C3", "C4", "C5"] });
  const review = { assessments: [{ path: "Company/Entry", finding: "Reviewed" }], candidateDecisions: [], confident: true, reason: "No changes", operations: [] };
  expect(() => validateDecisionCoverage(review, context)).toThrow("skipped a connected group");
  expect(() => validateDecisionCoverage({ ...review, candidateDecisions: [{ ref: "R1", disposition: "file", reason: "These claims belong together." }] }, context)).toThrow("no matching change");
});

it("flags large unsplit domains using independent ideas rather than duplicate row count", () => {
  const snapshot: DecisionSnapshot = { domains: [{ id: "d", name: "Procedure", path: "Company/Procedure", parent_id: null, retired_at: null, context_entity_id: null }],
    claims: Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, revisionId: `r${i}`, content: `Distinct requirement ${i}`, retiredAt: null })),
    unitDomains: Array.from({ length: 12 }, (_, i) => ({ unit_id: `c${i}`, domain_id: "d" })),
  };
  const vectors = new Map(snapshot.claims.map(c => [c.revisionId, [1,0]]));
  expect(clusterEvidence(snapshot, vectors).candidates[0]!.kind).toBe("large_unsubdivided_domain");
  const repeated = { ...snapshot, claims: snapshot.claims.map(c => ({ ...c, content: "One repeated requirement" })) };
  expect(clusterEvidence(repeated, vectors).candidates).toHaveLength(0);
  expect(clusterEvidence(repeated, vectors).domains[0]!.independentIdeasEstimate).toBe(1);
});

it("shares the graph's dotted similarity links and respects its display threshold", () => {
  const nodes: GraphNode[] = Array.from({ length: 4 }, (_, i) => ({ id: `c${i}`, kind: "unit", label: "Requirement", text: `Requirement ${i}`,
    href: "", createdAt: "", degree: 0, domainPaths: ["Company/Requirements"], entityNames: ["Company"], unitKind: null, status: null }));
  const graph: GraphData = { nodes, links: [] };
  expect(visibleSimilarityConnections(graph, 0.3, true).length).toBeGreaterThan(0);
  expect(visibleSimilarityConnections(graph, 0.3, true)[0]!.type).toBe("inferred_similarity");
  expect(visibleSimilarityConnections(graph, 0.3, false)).toEqual([]);
  expect(visibleSimilarityConnections(graph, 1, true)).toEqual([]);
});

it("lets a real connection strengthen a semantic cluster without crossing roots", () => {
  const snapshot: DecisionSnapshot = { domains: [
    { id: "d1", name: "A", path: "A", parent_id: null, retired_at: null, context_entity_id: null },
    { id: "d2", name: "B", path: "B", parent_id: null, retired_at: null, context_entity_id: null },
  ], claims: ["one", "two", "three"].map(id => ({ id, revisionId: id, content: id, retiredAt: null })),
    unitDomains: [{ unit_id: "one", domain_id: "d1" }, { unit_id: "two", domain_id: "d1" }, { unit_id: "three", domain_id: "d2" }],
  };
  const vectors = new Map([["one", [1, 0]], ["two", [0.7, Math.sqrt(0.51)]], ["three", [1, 0]]]);
  expect(clusterEvidence(snapshot, vectors).clusters).toHaveLength(3);
  const linked = clusterEvidence(snapshot, vectors, [{ from: "one", to: "two", type: "supports" }, { from: "one", to: "three", type: "supports" }]);
  expect(linked.clusters).toHaveLength(2);
  expect(linked.clusters[0]!.connections.adjacentDomains).toEqual([{ ref: "D2", links: 1 }]);
});
