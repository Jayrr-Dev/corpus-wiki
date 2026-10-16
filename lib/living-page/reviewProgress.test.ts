import { expect, it } from "vitest";
import { reviewStreamDetail } from "./reviewProgress";

it("previews a partially streamed public summary", () => {
  expect(reviewStreamDetail('{"summary":"Checking the citations')).toBe("Draft review: Checking the citations");
});
it("switches to edit preparation when edits start arriving", () => {
  expect(reviewStreamDetail('{"summary":"Checked","edits":[')).toContain("Preparing editorial fixes");
});
it("ignores incomplete escapes and unrelated output", () => {
  expect(reviewStreamDetail('{"summary":"Hello\\u00')).toBeNull();
  expect(reviewStreamDetail("")).toBeNull();
});
