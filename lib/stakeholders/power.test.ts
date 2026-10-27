import { describe, expect, it } from "vitest";
import type { StakeholderCard } from "./cards";
import type { StructureRelation } from "./structure";
import { computePower, levelOf, parseAmount, seniorityFromTitle, sizeFromFacts } from "./power";

function card(entityId: string, type: string, facts: Record<string, string> = {}, extra: Partial<StakeholderCard> = {}): StakeholderCard {
  return {
    entityId, name: entityId, type, aliases: [], description: null, kind: null, relation: null,
    keyFacts: Object.entries(facts).map(([label, value]) => ({ label, value, unitIds: [] })),
    functions: [], contacts: [], personContacts: [], hidden: false, generatedAt: null,
    web: null, webCheckedAt: null, logoUrl: null, person: null,
    claimCount: 1, sourceCount: 1, lastChangedAt: null, stale: false, isOurs: false, ...extra,
  };
}
const person = (entityId: string, extra: Partial<StakeholderCard> = {}) => card(entityId, "person", {}, extra);
function link(fromId: string, rel: StructureRelation["link"], toId: string, extra: Partial<StructureRelation> = {}): StructureRelation {
  return { fromId, toId, link: rel, title: null, seniority: null, share: null, current: true, unitIds: [], ...extra };
}
const scoreOf = (results: Map<string, { score: number }>, id: string) => results.get(id)!.score;

describe("parseAmount", () => {
  it("reads commas, words, short units and currency", () => {
    expect(parseAmount("12,000")).toBe(12_000);
    expect(parseAmount("About 45 000 staff")).toBe(45_000);
    expect(parseAmount("1.2 billion")).toBe(1.2e9);
    expect(parseAmount("$3B")).toBe(3e9);
    expect(parseAmount("€2.5bn (2023)")).toBe(2.5e9);
    expect(parseAmount("120k")).toBe(120_000);
    expect(parseAmount("1,001-5,000 employees")).toBe(5000);
  });

  it("skips years and percentages", () => {
    expect(parseAmount("Founded in 1998")).toBeNull();
    expect(parseAmount("Up 12% in 2024")).toBeNull();
    expect(parseAmount("12 months")).toBe(12);
  });
});

describe("sizeFromFacts", () => {
  it("turns money and population into staff-equivalents and keeps the biggest", () => {
    expect(sizeFromFacts([{ label: "Employees", value: "12,000" }])).toEqual({ size: 12_000, reason: "About 12,000 employees" });
    expect(sizeFromFacts([{ label: "Revenue", value: "$3B" }])?.size).toBe(12_000);
    expect(sizeFromFacts([{ label: "Population", value: "1.1 million" }, { label: "Staff", value: "14,000" }])?.reason).toBe("Serves about 1.1 million people");
    expect(sizeFromFacts([{ label: "Founded", value: "1998" }])).toBeNull();
  });
});

describe("seniorityFromTitle", () => {
  it("reads obvious titles and leaves the rest", () => {
    expect(seniorityFromTitle("CEO")).toBe("executive");
    expect(seniorityFromTitle("Vice President, Sales")).toBe("vice_president");
    expect(seniorityFromTitle("Deputy Minister of Energy")).toBe("top_official");
    expect(seniorityFromTitle("Mayor")).toBe("elected_leader");
    expect(seniorityFromTitle("Senior Engineer")).toBe("staff");
    expect(seniorityFromTitle("Wizard")).toBeNull();
    expect(seniorityFromTitle(null)).toBeNull();
  });
});

describe("levelOf", () => {
  it("is one level per factor of ten, from 1 to 5", () => {
    expect([-1, 0.5, 1.5, 2.5, 3.5, 4.5, 7].map(levelOf)).toEqual([1, 1, 2, 3, 4, 5, 5]);
  });
});

describe("computePower", () => {
  it("ranks an owner above what it owns", () => {
    const results = computePower(
      [card("A", "company", { Employees: "50" }), card("B", "company", { Employees: "400" })],
      [link("B", "owned_by", "A", { share: 0.6 })],
    );
    expect(scoreOf(results, "A")).toBeGreaterThan(scoreOf(results, "B"));
    expect(results.get("A")!.reasons).toContain("Owns 60 percent of B");
  });

  it("ranks a person whose company is much bigger above a small company's owner", () => {
    const results = computePower(
      [person("A"), card("SmallCo", "company", { Employees: "30" }), person("C"), card("BigCo", "company", { Employees: "50,000" })],
      [link("SmallCo", "owned_by", "A", { share: 1 }), link("C", "leads", "BigCo")],
    );
    expect(scoreOf(results, "A")).toBeGreaterThan(scoreOf(results, "SmallCo"));
    expect(scoreOf(results, "C")).toBeGreaterThan(scoreOf(results, "A"));
  });

  it("ranks a CEO above a staff member of the same company", () => {
    const results = computePower(
      [card("Co", "company", { Employees: "2,000" }), person("Ceo"), person("Clerk")],
      [link("Ceo", "leads", "Co", { title: "CEO" }), link("Clerk", "works_in", "Co", { seniority: "staff" })],
    );
    expect(scoreOf(results, "Ceo")).toBeGreaterThan(scoreOf(results, "Clerk") + 1);
  });

  it("lets a team lead in a huge company beat the CEO of a tiny one", () => {
    const results = computePower(
      [card("Huge", "company", { Employees: "200,000" }), card("Team", "team"), person("Lead"),
        card("Tiny", "company", { Employees: "8" }), person("TinyCeo")],
      [link("Team", "part_of", "Huge"), link("Lead", "leads", "Team", { seniority: "lead" }), link("TinyCeo", "leads", "Tiny")],
    );
    expect(scoreOf(results, "Lead")).toBeGreaterThan(scoreOf(results, "TinyCeo"));
    expect(results.get("Lead")!.reasons[0]).toBe("Leads Team at Huge");
  });

  it("finishes on ownership and part-of cycles", () => {
    const results = computePower(
      [card("A", "company", { Employees: "100" }), card("B", "company", { Employees: "100" }), card("X", "team"), card("Y", "team")],
      [link("A", "owned_by", "B", { share: 1 }), link("B", "owned_by", "A", { share: 1 }), link("X", "part_of", "Y"), link("Y", "part_of", "X")],
    );
    for (const id of ["A", "B", "X", "Y"]) {
      expect(Number.isFinite(scoreOf(results, id))).toBe(true);
      expect(scoreOf(results, id)).toBeLessThan(6);
    }
  });

  it("gives a child box a staff share of its parent, and a default share when unknown", () => {
    const results = computePower(
      [card("Co", "company", { Employees: "10,000" }), card("Eng", "department", { Employees: "1,000" }), card("Ops", "department")],
      [link("Eng", "part_of", "Co"), link("Ops", "part_of", "Co")],
    );
    expect(scoreOf(results, "Eng")).toBeCloseTo(3, 1);
    expect(results.get("Eng")!.estimated).toBe(false);
    expect(scoreOf(results, "Ops")).toBeCloseTo(Math.log10(3000), 1);
    expect(results.get("Ops")!.estimated).toBe(true);
  });

  it("estimates boxes with no numbers by kind, government level and authority", () => {
    const results = computePower(
      [card("Canada", "government", {}, { kind: "federal government" }), card("Town", "government", {}, { name: "Town of Smallville" }),
        card("Reg", "regulator", {}, { kind: "provincial regulator" }), card("Shop", "company")],
      [],
    );
    expect(scoreOf(results, "Canada")).toBeGreaterThan(scoreOf(results, "Town"));
    expect(scoreOf(results, "Reg")).toBeGreaterThan(scoreOf(results, "Shop"));
    expect(results.get("Reg")!.reasons).toContain("Regulator with legal authority");
    for (const result of results.values()) expect(result.estimated).toBe(true);
  });

  it("counts a person known only through their card's organization as working there", () => {
    const results = computePower(
      [card("Co", "company", { Employees: "5,000" }), person("Pat", { person: { title: "Director of Finance", organization: "Co", organizationEntityId: "Co", role: null, unitIds: [] } }), person("Nobody")],
      [],
    );
    expect(results.get("Pat")!.reasons[0]).toBe("Director of Finance at Co");
    expect(scoreOf(results, "Pat")).toBeCloseTo(Math.log10(5000 * 0.06), 1);
    expect(results.get("Nobody")!.level).toBe(1);
  });

  it("counts the biggest seat in full and others partly, and skips former seats", () => {
    const one = computePower([card("Co", "company", { Employees: "1,000" }), person("P")], [link("P", "leads", "Co")]);
    const two = computePower(
      [card("Co", "company", { Employees: "1,000" }), card("Other", "company", { Employees: "1,000" }), card("Old", "company", { Employees: "900,000" }), person("P")],
      [link("P", "leads", "Co"), link("P", "board_member_of", "Other"), link("P", "leads", "Old", { current: false })],
    );
    expect(scoreOf(two, "P")).toBeGreaterThan(scoreOf(one, "P"));
    expect(scoreOf(two, "P")).toBeLessThan(scoreOf(one, "P") + 0.5);
  });

  it("spreads a small workspace over all five levels", () => {
    const results = computePower(
      [card("Province", "government", { Population: "4.5 million" }), card("City", "government", { Population: "1 million" }),
        card("Planning", "department"), person("Mayor"), person("Planner"),
        card("Startup", "company", { Employees: "12" }), person("Founder"), person("Intern"), card("Firm", "company", { Employees: "400" })],
      [link("Planning", "part_of", "City"), link("Mayor", "leads", "City", { seniority: "elected_leader" }),
        link("Planner", "works_in", "Planning", { title: "Planner" }),
        link("Founder", "leads", "Startup"), link("Intern", "works_in", "Startup", { seniority: "entry" })],
    );
    const levels = new Set([...results.values()].map((result) => result.level));
    expect([...levels].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
