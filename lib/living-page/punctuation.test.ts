import { describe, expect, it } from "vitest";
import { withoutEditorialDashes } from "./punctuation";

describe("withoutEditorialDashes", () => {
  it("turns a paired em dash into parentheses and a single dash into a comma", () => {
    expect(withoutEditorialDashes("Class A violations—fighting, theft, and endangerment—warrant termination.")).toBe(
      "Class A violations (fighting, theft, and endangerment) warrant termination.",
    );
    expect(withoutEditorialDashes("basic items—hard hats and glasses—and specialized items")).toBe(
      "basic items (hard hats and glasses) and specialized items",
    );
    expect(withoutEditorialDashes("worn at all times—and specialized equipment")).toBe(
      "worn at all times, and specialized equipment",
    );
  });

  it("leaves hyphens in compound words", () => {
    expect(withoutEditorialDashes("Employee-owned PPE is not allowed.")).toBe("Employee-owned PPE is not allowed.");
  });
});

describe("withoutEditorialDashes on ranges", () => {
  it("keeps a range as a hyphenated range", () => {
    expect(withoutEditorialDashes("Inspections ran 2019–2021.")).toBe("Inspections ran 2019-2021.");
    expect(withoutEditorialDashes("Pages 3–5 and 7–9 apply.")).toBe("Pages 3-5 and 7-9 apply.");
    expect(withoutEditorialDashes("Shifts run 9:00 – 17:00, Monday–Friday.")).toBe("Shifts run 9:00-17:00, Monday-Friday.");
    expect(withoutEditorialDashes("Fees are $10–$20 or 10%–20%.")).toBe("Fees are $10-$20 or 10%-20%.");
  });

  it("still treats a spaced or em dash between words as editorial", () => {
    expect(withoutEditorialDashes("Wear gloves – always.")).toBe("Wear gloves, always.");
    expect(withoutEditorialDashes("Gear—hats and boots—is issued.")).toBe("Gear (hats and boots) is issued.");
  });
});

describe("withoutEditorialDashes on blocks", () => {
  it("keeps the line breaks of a list and a table", () => {
    expect(withoutEditorialDashes("Items include:\n- Hard hats—always\n- Gloves")).toBe("Items include:\n- Hard hats, always\n- Gloves");
    expect(withoutEditorialDashes("| A | B |\n|---|---|\n| 1 | 2 |")).toBe("| A | B |\n|---|---|\n| 1 | 2 |");
  });
});
