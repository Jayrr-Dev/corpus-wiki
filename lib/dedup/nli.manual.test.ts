import { describe, expect, it } from "vitest";
import { getNli } from "@/lib/ai/nli";
import { relate } from "./prefilter";

// MANUAL CHECK WITH THE REAL MODEL (downloads it on first run, a few hundred MB). Skipped unless
// DEDUP_NLI_MANUAL=1:  DEDUP_NLI_MANUAL=1 npx vitest run lib/dedup/nli.manual.test.ts
const pairs: [string, string, string[]][] = [
  ["The permit expires after 12 months.", "A permit is valid for one year.", ["same", "adds_detail"]],
  ["The permit expires after 12 months.", "The permit expires after 6 months.", ["contradicts"]],
  // Scored neutral 0.78 and 0.62 on 2026-10-26: below UNRELATED_MIN_NEUTRAL, so it is kept as unclear
  ["Workers must wear hard hats on site.", "The cafeteria opens at 7 am.", ["unrelated", "unclear"]],
  ["The supervisor signs the permit before work starts.", "The permit is signed before work starts.", ["same", "adds_detail"]],
];

describe.skipIf(!process.env.DEDUP_NLI_MANUAL)("real NLI model", () => {
  it("relates sample pairs", async () => {
    const nli = getNli({ NODE_ENV: "test", DEDUP_NLI: "on" });
    expect(nli).not.toBeNull();
    for (const [a, b, expected] of pairs) {
      const started = performance.now();
      const relation = await relate(a, b, nli);
      console.log(`${relation.padEnd(12)} ${Math.round(performance.now() - started)} ms  ${a} | ${b}`);
      expect(expected).toContain(relation);
    }
  }, 600_000);
});
