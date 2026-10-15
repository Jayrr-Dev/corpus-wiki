import { describe, expect, it } from "vitest";
import { diffPhrases, diffWords, tokenize, tokenizePhrases } from "./diffWords";

// Rebuilds one side of a diff from its parts
function side(parts: ReturnType<typeof diffWords>, drop: "added" | "removed"): string {
  return parts.filter((part) => part.kind !== drop).map((part) => part.text).join("");
}

describe("diffWords", () => {
  it("keeps whitespace as its own token", () => {
    expect(tokenize("a  b")).toEqual(["a", "  ", "b"]);
  });

  it("returns one kept part for equal texts", () => {
    expect(diffWords("Alpha ships in Q1.", "Alpha ships in Q1.")).toEqual([{ kind: "same", text: "Alpha ships in Q1." }]);
  });

  it("marks a replaced word as removed then added", () => {
    const parts = diffWords("planned for Q1 2027.", "planned for Q2 2027.");
    expect(parts).toEqual([
      { kind: "same", text: "planned for " },
      { kind: "removed", text: "Q1" },
      { kind: "added", text: "Q2" },
      { kind: "same", text: " 2027." },
    ]);
  });

  it("rebuilds both texts from the parts", () => {
    const before = "Alpha uses Postgres for storage.";
    const after = "Alpha uses SQLite and Postgres for local storage.";
    const parts = diffWords(before, after);
    expect(side(parts, "added")).toBe(before);
    expect(side(parts, "removed")).toBe(after);
  });

  it("handles empty sides", () => {
    expect(diffWords("", "new text")).toEqual([{ kind: "added", text: "new text" }]);
    expect(diffWords("old", "")).toEqual([{ kind: "removed", text: "old" }]);
  });
});

describe("diffPhrases", () => {
  it("marks the whole clause when one word in it changes", () => {
    const parts = diffPhrases("Meetings run every week. At a site, a meeting is held.", "Meetings run every week. At a job site, a meeting is held.");
    expect(parts).toEqual([
      { kind: "same", text: "Meetings run every week. " },
      { kind: "removed", text: "At a site," },
      { kind: "added", text: "At a job site," },
      { kind: "same", text: " a meeting is held." },
    ]);
  });

  it("splits only at clause punctuation followed by a space or the end", () => {
    expect(tokenizePhrases("Costs 3.5 units, then stop.")).toEqual(["Costs 3.5 units,", " ", "then stop."]);
  });
});
