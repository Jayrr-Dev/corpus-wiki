import { describe, expect, it } from "vitest";
import { comparable, cosine, likeness, normalizeClaim, sameClaimText } from "./similarity";

describe("normalizeClaim", () => {
  it("ignores case, spacing and the final stop", () => {
    expect(normalizeClaim("  Hard HATS   are required. ")).toBe("hard hats are required");
    expect(sameClaimText("Hard hats are required.", "hard hats are  required")).toBe(true);
    expect(sameClaimText("", "")).toBe(false);
  });
});

describe("likeness", () => {
  const policy = "Utilitek Solutions Inc. requires hearing protection for employees exposed to noise of 85 dB or greater.";

  it("settles the same text at once", () => {
    expect(likeness(comparable(policy), comparable(policy.toUpperCase()))).toMatchObject({ exact: true, candidate: true, score: 1 });
  });

  it("uses the vectors when both claims have one", () => {
    const near = likeness(comparable(policy, [1, 0]), comparable("Something else entirely here today.", [0.96, 0.28]));
    expect(near.candidate).toBe(true);
    expect(near.cosine).toBeCloseTo(0.96);
    const far = likeness(comparable(policy, [1, 0]), comparable(`${policy} Also more.`, [0.5, 0.866]));
    expect(far.candidate).toBe(false);
  });

  it("falls back to word overlap, and never trusts it for very short claims", () => {
    const reworded = "Utilitek Solutions Inc. requires hearing protection whenever employees face noise of 85 dB or greater.";
    expect(likeness(comparable(policy), comparable(reworded))).toMatchObject({ candidate: true, cosine: null });
    expect(likeness(comparable("Hearing protection"), comparable("Hearing protection required")).candidate).toBe(false);
  });
});

describe("cosine", () => {
  it("is 1 for one direction, 0 for right angles and for empty vectors", () => {
    expect(cosine([2, 0], [5, 0])).toBe(1);
    expect(cosine([1, 0], [0, 3])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});
