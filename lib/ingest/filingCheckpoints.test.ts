import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { filingStepKey, legacyFilingPrefix } from "./filingCheckpoints";

const claims = [{ ref: "C1", unitId: "u1", content: "Type One seeks integrity." }, { ref: "C2", unitId: "u2", content: "Type Two seeks connection." }];
const revisions = new Map([["u1", "r1"], ["u2", "r2"]]);

it("keys a step by its claims, their revisions and its scope, not the rest of the upload", () => {
  const key = filingStepKey("review", claims, revisions, "Enneagram");
  expect(key).toMatch(/^place-v5:review:[0-9a-f]{24}$/);
  expect(filingStepKey("review", claims.map((c) => ({ ...c })), new Map([...revisions, ["other", "r9"]]), "Enneagram")).toBe(key);
  expect(filingStepKey("review", claims, new Map([["u1", "r1b"], ["u2", "r2"]]), "Enneagram")).not.toBe(key);
  expect(filingStepKey("review", claims, revisions, "Enneagram/Type One")).not.toBe(key);
  expect(filingStepKey("review", [claims[1]!, claims[0]!], revisions, "Enneagram")).not.toBe(key);
  expect(filingStepKey("review", claims.map((c, i) => ({ ...c, ref: `C${i + 2}` })), revisions, "Enneagram")).not.toBe(key);
  expect(filingStepKey("plan:0", claims, revisions)).not.toBe(filingStepKey("plan:160", claims, revisions));
});

it("rebuilds the place-v4 prefix of uploads already in flight exactly", () => {
  const context = { claims, sourceTitle: "Book.pdf" };
  expect(legacyFilingPrefix(context)).toBe(`place-v4:${createHash("sha256").update(JSON.stringify(context)).digest("hex").slice(0, 24)}`);
});
