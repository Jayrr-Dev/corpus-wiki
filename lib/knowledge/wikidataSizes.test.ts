import { describe, expect, it } from "vitest";
import { sizeFromFacts } from "@/lib/stakeholders/power";
import { type Claims, sizeFactsFromClaims } from "./wikidataSizes";

const quantity = (amount: string, unit = "1", extra: Record<string, unknown> = {}) => ({
  mainsnak: { datavalue: { value: { amount, unit: unit === "1" ? "1" : `http://www.wikidata.org/entity/${unit}` } } }, ...extra,
});
const at = (year: number) => ({ qualifiers: { P585: [{ datavalue: { value: { time: `+${year}-00-00T00:00:00Z` } } }] } });

describe("sizeFactsFromClaims", () => {
  it("reads employees, revenue in dollars and population", () => {
    const claims: Claims = {
      P1128: [quantity("+170000", "1", at(2022)), quantity("+171000", "1", at(2023))],
      P2139: [quantity("+77794000000", "Q4917", at(2023))],
      P1082: [quantity("+1010899")],
    };
    expect(sizeFactsFromClaims(claims)).toEqual([
      { label: "Employees", value: "171,000 (2023)" },
      { label: "Revenue", value: "US$77.8 billion (2023)" },
      { label: "Population", value: "1.01 million" },
    ]);
  });

  it("converts known currencies, skips unknown ones and deprecated claims, prefers preferred rank", () => {
    const claims: Claims = {
      P2139: [quantity("+3000000000", "Q1104069", at(2024))],
      P2403: [quantity("+5000000", "Q999999")],
      P1128: [{ ...quantity("+9000", "1", at(2024)), rank: "deprecated" }, { ...quantity("+7000", "1", at(2020)), rank: "preferred" }, quantity("+8000", "1", at(2023))],
    };
    expect(sizeFactsFromClaims(claims)).toEqual([
      { label: "Employees", value: "7,000 (2020)" },
      { label: "Revenue", value: "US$2.19 billion (2024)" },
    ]);
  });

  it("gives facts the power score reads as sizes", () => {
    const facts = sizeFactsFromClaims({ P1128: [quantity("+12000")], P2139: [quantity("+77794000000", "Q4917", at(2023))] });
    // US$77.8 billion at US$200,000 per staff-equivalent beats 12,000 employees
    expect(sizeFromFacts(facts)?.size).toBeGreaterThan(300_000);
  });
});
