import { describe, expect, it } from "vitest";
import { glossaryRegistry, identifyGlossaryEntries, reuseReviewedMeanings } from "./identity";
import type { GlossaryEntry } from "./entries";

const entry = (term = "Four-gas monitor"): GlossaryEntry => ({ term, expansion: null, aliases: [], category: "technical term", definition: "A four-gas instrument that measures confined-space atmospheres.", context: null, scopeKey: "[null]", citations: [{ unitId: "u1", revisionId: "r1", sourceId: "s1", sourceTitle: "Safety" }] });

describe("stable glossary meanings", () => {
  it("reuses already reviewed meanings while keeping new and superseded evidence in the detector", () => {
    const first = identifyGlossaryEntries([entry()], {});
    const previous = [{ ...first[0]!, usageNotes: [] }];
    const registry = glossaryRegistry(previous, {});
    const current = identifyGlossaryEntries([entry(), { ...entry("Unrelated term"), citations: [{ ...entry().citations[0]!, unitId: "u2" }] }], registry);
    const reused = reuseReviewedMeanings(current, previous, registry, () => true);
    expect(reused).toHaveLength(2);
    expect(reused[0]).toMatchObject({ meaningId: previous[0]!.meaningId, established: true });
    const changed = reuseReviewedMeanings(current, previous, registry, () => false);
    expect(changed.every((item) => !item.established)).toBe(true);
  });
  it("reuses a meaning ID across regeneration and a changed source revision", () => {
    const first = identifyGlossaryEntries([entry()], {});
    const registry = glossaryRegistry(first, {});
    const changed = { ...entry("Four gas monitors"), definition: "An updated description of the same four-gas instrument.", citations: [{ ...entry().citations[0]!, revisionId: "r2" }] };
    const second = identifyGlossaryEntries([changed], registry, {}, first);
    expect(second[0]?.meaningId).toBe(first[0]?.meaningId);
    expect(second[0]?.historyKeys).toContain("four-gas monitor||[null]");
  });
  it("retains tombstones and explicit edits across regenerated batches", () => {
    const first = identifyGlossaryEntries([entry()], {});
    const registry = glossaryRegistry(first, {});
    const id = first[0]!.meaningId!;
    expect(identifyGlossaryEntries([entry()], registry, { [id]: { deleted: true } })).toEqual([]);
    expect(identifyGlossaryEntries([entry()], registry, { [id]: { definition: "A person's reviewed meaning.", separate: true } })[0])
      .toMatchObject({ meaningId: id, personEdited: true, keepSeparate: true, definition: "A person's reviewed meaning." });
  });
  it("redirects old origins to the surviving meaning", () => {
    const registry = glossaryRegistry([{ ...entry(), meaningId: "survivor", originKeys: ["new"], redirectIds: ["old"] }], { original: "old" });
    expect(registry).toEqual({ original: "survivor", new: "survivor" });
  });
});
