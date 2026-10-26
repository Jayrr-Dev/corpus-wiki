import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "./fusion";

describe("reciprocalRankFusion", () => {
  it("keeps the order of a single list", () => {
    expect(reciprocalRankFusion([["a", "b", "c", "d"]])).toEqual(["a", "b", "c", "d"]);
  });

  it("ranks an id that several lists agree on above one list's top pick", () => {
    expect(reciprocalRankFusion([["a", "b", "c"], ["d", "b", "e"], ["f", "g", "b"]])[0]).toBe("b");
  });

  it("scores by 1 / (k + rank) with k defaulting to 60", () => {
    // a: 1/61 + 1/63; b: 1/62 + 1/61. b wins on score alone.
    expect(reciprocalRankFusion([["a", "b"], ["b", "x", "a"]])).toEqual(["b", "a", "x"]);
    // With k = 0: a: 1 + 1/3, b: 1/2 + 1, c: 1/2.
    expect(reciprocalRankFusion([["a", "b"], ["b", "c", "a"]], { k: 0 })).toEqual(["b", "a", "c"]);
  });

  it("drops what falls past the cap in each list", () => {
    expect(reciprocalRankFusion([["a", "b", "c"], ["d", "c", "e"]], { cap: 2 })).toEqual(["a", "d", "b", "c"]);
    expect(reciprocalRankFusion([["a", "b", "c"]], { cap: 0 })).toEqual(["a", "b", "c"]);
    expect(reciprocalRankFusion([["a", "b", "c"]], { cap: -1 })).toEqual(["a", "b", "c"]);
  });

  it("counts a duplicate within one list once, at its best rank", () => {
    // Without the duplicate rule, a would collect 1/61 + 1/62 + 1/63 and pass b.
    expect(reciprocalRankFusion([["a", "a", "a"], ["b"], ["b"]])).toEqual(["b", "a"]);
    expect(reciprocalRankFusion([["x", "a", "a"], ["a", "y"]])).toEqual(["a", "x", "y"]);
    // A duplicate still takes a place, so the cap counts it
    expect(reciprocalRankFusion([["a", "a", "b"]], { cap: 2 })).toEqual(["a"]);
  });

  it("breaks ties by best single rank, then by first appearance", () => {
    // With k = 0, p scores 1/2 + 1/2 and ties q and r at 1, but its best rank is only 2
    expect(reciprocalRankFusion([["q", "p"], ["r", "p"]], { k: 0 })).toEqual(["q", "r", "p"]);
    // b and c each score 1/61 + 1/63 with best rank 1
    expect(reciprocalRankFusion([["b", "a", "c"], ["c", "d", "b"]])).toEqual(["b", "c", "a", "d"]);
    // Equal score and equal best rank: the id met first comes first
    expect(reciprocalRankFusion([["a"], ["b"]])).toEqual(["a", "b"]);
    expect(reciprocalRankFusion([["b"], ["a"]])).toEqual(["b", "a"]);
    expect(reciprocalRankFusion([["x", "a", "y"], ["z", "b", "w"]])).toEqual(["x", "z", "a", "b", "y", "w"]);
  });

  it("returns an empty list for empty input", () => {
    expect(reciprocalRankFusion([])).toEqual([]);
    expect(reciprocalRankFusion([[], []])).toEqual([]);
  });
});
