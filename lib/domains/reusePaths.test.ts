import { describe, expect, it } from "vitest";
import { reuseDomainPaths } from "./reusePaths";

describe("reuse established domain branches", () => {
  const company = "Utilitek Solutions Inc.";
  it("reuses the company root and topic spelling across later uploads", () => {
    const resolve = reuseDomainPaths([company, `${company}/Health & Safety`, `${company}/Health & Safety/Inspections`]);
    expect(resolve(" utilitek solutions inc / Health and Safety / Quality Inspection ")).toBe(`${company}/Health & Safety/Inspections`);
    expect(resolve("Utilitek Solutions Inc/Health & Safety/Inspections/Monthly")).toBe(`${company}/Health & Safety/Inspections/Monthly`);
  });
  it("keeps different companies and their identically named topics separate", () => {
    const resolve = reuseDomainPaths([`${company}/Health & Safety/Inspections`, "Other Company/Health & Safety/Inspection"]);
    expect(resolve("Other Company/health and safety/inspections")).toBe("Other Company/Health & Safety/Inspection");
    expect(resolve("New Company/Health & Safety")).toBe("New Company/Health & Safety");
  });
  it("deduplicates new spelling variants within one upload", () => {
    const resolve = reuseDomainPaths([company]);
    expect(resolve(`${company}/Health & Safety/Inspections`)).toBe(`${company}/Health & Safety/Inspections`);
    expect(resolve(`${company}/Health and Safety/Inspection`)).toBe(`${company}/Health & Safety/Inspections`);
  });
  it("does not guess when existing branches are ambiguous", () => {
    const resolve = reuseDomainPaths(["Company/Inspection", "Company/Inspections"]);
    expect(resolve("Company/Inspection")).toBe("Company/Inspection");
    expect(resolve("Company/Quality Inspection")).toBe("Company/Quality Inspection");
  });
});
