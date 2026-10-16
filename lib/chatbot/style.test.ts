import { describe, expect, it } from "vitest";
import { humanizeChatPunctuation } from "./style";

describe("human chat punctuation", () => {
  it("removes dash asides without joining words or dropping citations", () => {
    expect(humanizeChatPunctuation("Check early—before shipping—and record defects. [K1]"))
      .toBe("Check early, before shipping, and record defects. [K1]");
  });
  it("preserves numeric ranges and ordinary hyphens", () => {
    expect(humanizeChatPunctuation("Check 10–15% of a self-paced run."))
      .toBe("Check 10-15% of a self-paced run.");
  });
  it("preserves verbatim quotes", () => {
    expect(humanizeChatPunctuation('The source says "check early—before shipping".'))
      .toBe('The source says "check early—before shipping".');
  });
});
