import { describe, expect, it } from "vitest";
import { wordDiff } from "./wordDiff";

describe("wordDiff", () => {
  it("marks inserted and dropped words, merging runs", () => {
    expect(wordDiff("covering premises, job sites, tools", "covering premises, job sites, buildings, temporary tools")).toEqual([
      { kind: "same", text: "covering premises, job sites," },
      { kind: "added", text: "buildings, temporary" },
      { kind: "same", text: "tools" },
    ]);
    expect(wordDiff("a b c", "a c")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "same", text: "c" },
    ]);
  });

  it("treats a word with new punctuation as kept", () => {
    expect(wordDiff("conducts documented workplace", "conducts documented, planned workplace")).toEqual([
      { kind: "same", text: "conducts documented," },
      { kind: "added", text: "planned" },
      { kind: "same", text: "workplace" },
    ]);
  });

  it("gives up on very long texts", () => {
    expect(wordDiff("x ".repeat(500), "y")).toBeNull();
  });
});
