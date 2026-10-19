import { describe, expect, it } from "vitest";
import { type GroupUnit, groupKey, groupUnits, pairAffinity, withoutDismissed } from "./group";

// A unit vector pointing mostly along one axis, tilted slightly so units differ
function unit(id: string, axis: number, tilt = 0, extra: Partial<GroupUnit> = {}): GroupUnit {
  const vector = new Array(8).fill(0);
  vector[axis] = 1;
  vector[(axis + 1) % 8] = tilt;
  return { id, revisionId: `r-${id}`, vector, domainIds: [], rootDomainId: null, entityIds: [], sourceIds: [], ...extra };
}

describe("groupUnits", () => {
  it("groups units on the same subject and leaves the rest ungrouped", () => {
    const units = [unit("a1", 0, 0.1), unit("a2", 0, 0.2), unit("a3", 0, 0.3), unit("b1", 3, 0.1), unit("b2", 3, 0.2), unit("b3", 3, 0.25), unit("lone", 6)];
    const { groups, ungrouped } = groupUnits(units, []);
    expect(groups.map((group) => group.unitIds).sort()).toEqual([["a1", "a2", "a3"], ["b1", "b2", "b3"]]);
    expect(ungrouped).toEqual(["lone"]);
    expect(groups.every((group) => group.signals.cohesion > 0.9)).toBe(true);
  });

  it("is deterministic whatever the input order", () => {
    const units = [unit("a1", 0, 0.1), unit("a2", 0, 0.2), unit("a3", 0, 0.3), unit("b1", 3), unit("b2", 3, 0.1), unit("b3", 3, 0.2)];
    expect(groupUnits([...units].reverse(), [])).toEqual(groupUnits(units, []));
  });

  it("drops groups smaller than the minimum and never exceeds the maximum", () => {
    const many = Array.from({ length: 9 }, (_, index) => unit(`m${index}`, 0, index / 100));
    const { groups } = groupUnits(many, [], { maxSize: 4 });
    expect(Math.max(...groups.map((group) => group.unitIds.length))).toBeLessThanOrEqual(4);
    const pair = groupUnits([unit("p1", 2), unit("p2", 2, 0.1)], []);
    expect(pair.groups).toEqual([]);
    expect(pair.ungrouped).toEqual(["p1", "p2"]);
  });

  it("lets links, entities and domains join borderline units, but not unrelated ones", () => {
    // cosine ≈ 0.69: just under the join threshold on its own
    const a = unit("a", 0, 0), b = unit("b", 0, 1.05);
    expect(pairAffinity(a, b, false).affinity).toBeLessThan(0.72);
    expect(pairAffinity({ ...a, entityIds: ["e"], domainIds: ["d"] }, { ...b, entityIds: ["e"], domainIds: ["d"] }, true).affinity).toBeGreaterThan(0.72);
    // orthogonal vectors get no bonus at all
    const far = unit("far", 4);
    expect(pairAffinity({ ...a, entityIds: ["e"] }, { ...far, entityIds: ["e"] }, true).affinity).toBe(0);
  });

  it("records the signals behind a group", () => {
    const shared = { entityIds: ["acme"], domainIds: ["safety"], sourceIds: ["s1"] };
    const units = [unit("a", 0, 0.1, shared), unit("b", 0, 0.2, shared), unit("c", 0, 0.3, { ...shared, entityIds: [] })];
    const [group] = groupUnits(units, [{ from: "a", to: "b", type: "supports" }, { from: "b", to: "c", type: "supersedes" }]).groups;
    expect(group!.signals).toMatchObject({ links: 1, sharedEntityIds: ["acme"], sharedDomainIds: ["safety"], sharedSources: 1 });
  });

  it("groups each root domain separately when the set is large", () => {
    const units = [unit("a1", 0, 0.1, { rootDomainId: "x" }), unit("a2", 0, 0.2, { rootDomainId: "x" }), unit("a3", 0, 0.3, { rootDomainId: "y" }), unit("a4", 0, 0.15, { rootDomainId: "y" })];
    expect(groupUnits(units, [], { partitionAbove: 3, minSize: 2 }).groups.map((group) => group.unitIds)).toEqual([["a1", "a2"], ["a3", "a4"]]);
  });
});

describe("withoutDismissed", () => {
  const group = { key: groupKey([{ id: "a", revisionId: "1" }]), unitIds: ["a", "b", "c", "d", "e"], revisionIds: ["1", "1", "1", "1", "1"],
    signals: { cohesion: 1, links: 0, sharedEntityIds: [], sharedDomainIds: [], sharedSources: 0 } };

  it("hides a group that matches a dismissed suggestion", () => {
    expect(withoutDismissed([group], [{ unitIds: ["a", "b", "c", "d"], revisionIds: ["1", "1", "1", "1"] }])).toEqual([]);
  });

  it("brings it back once its knowledge changed", () => {
    expect(withoutDismissed([group], [{ unitIds: ["a", "b", "c", "d"], revisionIds: ["1", "1", "0", "0"] }])).toEqual([group]);
  });
});
