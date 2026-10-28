import { describe, expect, it } from "vitest";
import type { StakeholderCard } from "./cards";
import type { StructureRelation } from "./structure";
import { POWER_MODEL, computePower, computePowerOverUs, levelOf, parseAmount, seniorityFromTitle, sizeFromFacts, timeWeight } from "./power";

const NOW = new Date("2026-10-28T00:00:00Z");

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
  return { fromId, toId, link: rel, title: null, seniority: null, share: null, current: true, since: null, until: null, asOf: null, unitIds: [], ...extra };
}
const power = (cards: StakeholderCard[], relations: StructureRelation[], now = NOW) => computePower(cards, relations, now);
const scoreOf = (results: Map<string, { score: number }>, id: string) => results.get(id)!.score;

describe("parseAmount", () => {
  it("reads commas, words, short units and currency", () => {
    expect(parseAmount("12,000")).toBe(12_000);
    expect(parseAmount("About 45 000 staff")).toBe(45_000);
    expect(parseAmount("1.2 billion")).toBe(1.2e9);
    expect(parseAmount("$3B")).toBe(3e9);
    expect(parseAmount("€2.5bn (2023)")).toBe(2.5e9);
    expect(parseAmount("120k")).toBe(120_000);
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
    expect(sizeFromFacts([{ label: "Revenue", value: "$3B" }])?.size).toBe(15_000);
    expect(sizeFromFacts([{ label: "Population", value: "1.1 million" }, { label: "Staff", value: "14,000" }])?.reason).toBe("Serves about 1.1 million people");
    expect(sizeFromFacts([{ label: "Founded", value: "1998" }])).toBeNull();
  });
});

describe("seniorityFromTitle", () => {
  it("reads obvious titles and leaves the rest", () => {
    expect(seniorityFromTitle("CEO")).toBe("executive");
    expect(seniorityFromTitle("Vice President, Sales")).toBe("vice_president");
    expect(seniorityFromTitle("Deputy Minister of Energy")).toBe("top_official");
    expect(seniorityFromTitle("Senior Engineer")).toBe("staff");
    expect(seniorityFromTitle("Wizard")).toBeNull();
  });
});

describe("timeWeight", () => {
  it("counts current links in full and stale ones a bit less", () => {
    expect(timeWeight({ current: true, until: null, asOf: "2025-06" }, NOW)).toEqual({ t: 1, stale: false, former: false });
    expect(timeWeight({ current: true, until: null, asOf: "2021" }, NOW)).toEqual({ t: POWER_MODEL.timeWeight.stale, stale: true, former: false });
  });

  it("starts a former link at half, halves it every 5 years, and stops at the floor", () => {
    expect(timeWeight({ current: false, until: "2026-10-28", asOf: null }, NOW).t).toBeCloseTo(0.5);
    expect(timeWeight({ current: false, until: "2021-10-28", asOf: null }, NOW).t).toBeCloseTo(0.25, 2);
    expect(timeWeight({ current: false, until: "1990", asOf: null }, NOW).t).toBe(POWER_MODEL.timeWeight.formerFloor);
    expect(timeWeight({ current: false, until: null, asOf: null }, NOW).t).toBe(POWER_MODEL.timeWeight.formerFloor);
  });
});

describe("levelOf", () => {
  it("uses fixed powers of ten of staff-equivalents", () => {
    expect([0.5, 9.9, 10, 99, 100, 999, 1000, 9999, 10_000, 5e6].map(levelOf)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });
});

describe("computePower", () => {
  it("ranks an owner above what it owns", () => {
    const results = power(
      [card("A", "company", { Employees: "50" }), card("B", "company", { Employees: "400" })],
      [link("B", "owned_by", "A", { share: 0.6 })],
    );
    expect(scoreOf(results, "A")).toBeGreaterThan(scoreOf(results, "B"));
    expect(results.get("A")!.reasons).toContain("Owns 60 percent of B");
  });

  it("ranks C above A when C's company is far bigger than A's", () => {
    const results = power(
      [person("A"), card("SmallCo", "company", { Employees: "30" }), person("C"), card("BigCo", "company", { Employees: "50,000" })],
      [link("SmallCo", "owned_by", "A", { share: 1 }), link("C", "leads", "BigCo")],
    );
    expect(scoreOf(results, "A")).toBeGreaterThan(scoreOf(results, "SmallCo"));
    expect(scoreOf(results, "C")).toBeGreaterThan(scoreOf(results, "A"));
  });

  it("ranks a CEO above a staff member of the same company", () => {
    const results = power(
      [card("Co", "company", { Employees: "2,000" }), person("Ceo"), person("Clerk")],
      [link("Ceo", "leads", "Co", { title: "CEO" }), link("Clerk", "works_in", "Co", { seniority: "staff" })],
    );
    expect(scoreOf(results, "Ceo")).toBeGreaterThan(scoreOf(results, "Clerk") + 1);
  });

  it("lets a team lead in a huge company beat the CEO of a tiny one", () => {
    const results = power(
      [card("Huge", "company", { Employees: "200,000" }), card("Team", "team"), person("Lead"),
        card("Tiny", "company", { Employees: "8" }), person("TinyCeo")],
      [link("Team", "part_of", "Huge"), link("Lead", "leads", "Team", { seniority: "lead" }), link("TinyCeo", "leads", "Tiny")],
    );
    expect(scoreOf(results, "Lead")).toBeGreaterThan(scoreOf(results, "TinyCeo"));
    expect(results.get("Lead")!.reasons[0]).toBe("Leads Team at Huge");
  });

  it("ranks the current director above a former director with identical links and years", () => {
    const results = power(
      [card("Co", "company", { Employees: "1,000" }), card("Board", "organization", { Employees: "300" }), person("Current"), person("Former")],
      [
        link("Current", "works_in", "Co", { seniority: "director", since: "2016-10-28" }),
        link("Former", "works_in", "Co", { seniority: "director", since: "2011-01-01", until: "2021-01-01", current: false }),
        link("Current", "board_member_of", "Board", { since: "2020-10-28" }),
        link("Former", "board_member_of", "Board", { since: "2020-10-28" }),
      ],
    );
    expect(scoreOf(results, "Current")).toBeGreaterThan(scoreOf(results, "Former"));
    expect(results.get("Former")!.reasons).toContain("Former director of Co until 2021");
  });

  it("fades a former seat as years pass, but never below the floor", () => {
    const cards = [card("Co", "company", { Employees: "1,000" }), person("Ex")];
    const relations = [link("Ex", "works_in", "Co", { seniority: "manager", until: "2024-01-01", current: false })];
    const soon = scoreOf(power(cards, relations, new Date("2025-01-01")), "Ex");
    const later = scoreOf(power(cards, relations, new Date("2030-01-01")), "Ex");
    const muchLater = scoreOf(power(cards, relations, new Date("2060-01-01")), "Ex");
    const evenLater = scoreOf(power(cards, relations, new Date("2100-01-01")), "Ex");
    expect(later).toBeLessThan(soon);
    expect(muchLater).toBeLessThan(later);
    expect(evenLater).toBe(muchLater);
    // The floor is 20 percent of what the seat gave, with experience and network on top
    expect(evenLater).toBeGreaterThan(Math.log10(1000 * 0.04 * 0.2) - 0.01);
  });

  it("ranks a former CEO with board seats elsewhere above a new staff member and a new small-company CEO", () => {
    const results = power(
      [card("Co", "company", { Employees: "5,000" }), card("X", "company", { Employees: "800" }), card("Y", "organization", { Employees: "300" }),
        card("Small", "company", { Employees: "30" }), person("ExCeo"), person("NewStaff"), person("NewCeo")],
      [
        link("ExCeo", "leads", "Co", { title: "CEO", since: "2005", until: "2020", current: false }),
        link("ExCeo", "board_member_of", "X", { since: "2021" }), link("ExCeo", "board_member_of", "Y", { since: "2022" }),
        link("NewStaff", "works_in", "Co", { seniority: "staff", since: "2026-09" }),
        link("NewCeo", "leads", "Small", { since: "2026-06" }),
      ],
    );
    expect(scoreOf(results, "ExCeo")).toBeGreaterThan(scoreOf(results, "NewStaff"));
    expect(scoreOf(results, "ExCeo")).toBeGreaterThan(scoreOf(results, "NewCeo"));
    expect(results.get("ExCeo")!.reasons).toContain("Former CEO of Co until 2020");
    expect(results.get("ExCeo")!.reasons.some((reason) => reason.startsWith("Connected to 3 organizations"))).toBe(true);
  });

  it("finishes on ownership and part-of cycles", () => {
    const results = power(
      [card("A", "company", { Employees: "100" }), card("B", "company", { Employees: "100" }), card("X", "team"), card("Y", "team")],
      [link("A", "owned_by", "B", { share: 1 }), link("B", "owned_by", "A", { share: 1 }), link("X", "part_of", "Y"), link("Y", "part_of", "X")],
    );
    for (const id of ["A", "B"]) expect(scoreOf(results, id)).toBeLessThan(3);
    for (const id of ["X", "Y"]) expect(scoreOf(results, id)).toBeGreaterThan(0);
  });

  it("keeps a parent steady over four children with no numbers", () => {
    const teams = ["T1", "T2", "T3", "T4"];
    const results = power(
      [card("Co", "company", { Employees: "1,000" }), ...teams.map((id) => card(id, "team"))],
      teams.map((id) => link(id, "part_of", "Co")),
    );
    expect(scoreOf(results, "Co")).toBeCloseTo(3, 2);
    for (const id of teams) expect(scoreOf(results, id)).toBeCloseTo(Math.log10(300), 2);
  });

  it("keeps a 100 percent mutual ownership pair near its own size", () => {
    const results = power(
      [card("A", "company", { Employees: "100" }), card("B", "company", { Employees: "100" })],
      [link("A", "owned_by", "B", { share: 1 }), link("B", "owned_by", "A", { share: 1 })],
    );
    for (const id of ["A", "B"]) {
      expect(scoreOf(results, id)).toBeGreaterThanOrEqual(2);
      expect(scoreOf(results, id)).toBeLessThan(Math.log10(250));
    }
  });

  it("puts a small holding company just above its bigger operating company, without growing either", () => {
    const results = power(
      [card("Holding", "company", { Employees: "10" }), card("Operating", "company", { Employees: "5,000" })],
      [link("Operating", "owned_by", "Holding", { share: 1 })],
    );
    expect(scoreOf(results, "Operating")).toBeCloseTo(Math.log10(5000), 2);
    expect(scoreOf(results, "Holding")).toBeGreaterThan(scoreOf(results, "Operating"));
    expect(scoreOf(results, "Holding")).toBeLessThan(Math.log10(5000 * 1.5));
  });

  it("gives a child box a staff share of its parent, and a default share when unknown", () => {
    const results = power(
      [card("Co", "company", { Employees: "10,000" }), card("Eng", "department", { Employees: "1,000" }), card("Ops", "department")],
      [link("Eng", "part_of", "Co"), link("Ops", "part_of", "Co")],
    );
    expect(scoreOf(results, "Eng")).toBeCloseTo(3, 1);
    expect(results.get("Eng")!.estimated).toBe(false);
    expect(scoreOf(results, "Ops")).toBeCloseTo(Math.log10(3000), 1);
    expect(results.get("Ops")!.estimated).toBe(true);
  });

  it("lifts a parent to the known sizes of its parts", () => {
    const results = power(
      [card("Co", "company"), card("Eng", "department", { Employees: "1,500" }), card("Ops", "department", { Employees: "500" })],
      [link("Eng", "part_of", "Co"), link("Ops", "part_of", "Co")],
    );
    expect(scoreOf(results, "Co")).toBeCloseTo(Math.log10(2000), 1);
  });

  it("gives a box a little of the power of whom it regulates, funds or hires", () => {
    const alone = power([card("Reg", "regulator", { Employees: "300" }), card("Big", "company", { Employees: "50,000" })], []);
    const regulating = power([card("Reg", "regulator", { Employees: "300" }), card("Big", "company", { Employees: "50,000" })], [link("Reg", "regulates", "Big")]);
    expect(scoreOf(regulating, "Reg")).toBeGreaterThan(scoreOf(alone, "Reg"));
    expect(regulating.get("Reg")!.reasons[0]).toBe("Regulates Big");
  });

  it("estimates boxes with no numbers by kind and government level", () => {
    const results = power(
      [card("Canada", "government", {}, { kind: "federal government" }), card("Town", "government", {}, { name: "Town of Smallville" }),
        card("Reg", "regulator"), card("Shop", "company"), card("Bank", "company", {}, { name: "National Bank" })],
      [],
    );
    expect(results.get("Canada")!.level).toBe(5);
    expect(results.get("Town")!.score).toBeCloseTo(Math.log10(5000), 2);
    expect(results.get("Reg")!.score).toBeCloseTo(Math.log10(2000), 2);
    expect(results.get("Bank")!.score).toBeCloseTo(Math.log10(200), 2);
    for (const result of results.values()) expect(result.estimated).toBe(true);
  });

  it("marks a result estimated when its link is stale", () => {
    const results = power([card("Co", "company", { Employees: "1,000" }), person("P")], [link("P", "leads", "Co", { asOf: "2019" })]);
    expect(results.get("P")!.estimated).toBe(true);
    expect(results.get("P")!.reasons[0]).toBe("Leads Co (as of 2019)");
  });

  it("counts a person known only through their card's organization as working there", () => {
    const results = power(
      [card("Co", "company", { Employees: "5,000" }), person("Pat", { person: { title: "Director of Finance", organization: "Co", organizationEntityId: "Co", role: null, unitIds: [] } }), person("Nobody")],
      [],
    );
    expect(results.get("Pat")!.reasons[0]).toBe("Director of Finance at Co");
    expect(results.get("Pat")!.level).toBe(3);
    expect(results.get("Nobody")!.level).toBe(1);
  });

  it("ranks a boss above each current direct report", () => {
    const results = power(
      [card("Co", "company", { Employees: "1,000" }), person("Boss"), person("Report")],
      [link("Report", "works_in", "Co", { seniority: "director" }), link("Report", "reports_to", "Boss")],
    );
    expect(scoreOf(results, "Boss")).toBeGreaterThan(scoreOf(results, "Report"));
  });
});

describe("computePowerOverUs", () => {
  const cards = [card("Us", "company", { Employees: "50" }), card("Reg", "regulator", { Employees: "300" }), card("Huge", "company", { Employees: "25,000" }),
    card("Parent", "company", { Employees: "400" }), card("Funder", "foundation", { Employees: "100" }), card("Friend", "company", { Employees: "100" })];
  const relations = [link("Reg", "regulates", "Us"), link("Us", "owned_by", "Parent", { share: 1 }), link("Funder", "funds", "Us"), link("Friend", "contracts_with", "Funder")];

  it("ranks a small regulator of us above a huge unrelated company", () => {
    const results = computePowerOverUs(cards, relations, "Us", NOW);
    expect(scoreOf(results, "Reg")).toBeGreaterThan(scoreOf(results, "Huge"));
    expect(results.get("Reg")!.reasons[0]).toBe("Regulates Us");
    expect(results.get("Huge")!.reasons[0]).toBe("Not connected to Us");
  });

  it("scales by closeness: our owner in full, a funder less, two links away a quarter", () => {
    const general = computePower(cards, relations, NOW);
    const overUs = computePowerOverUs(cards, relations, "Us", NOW);
    expect(scoreOf(overUs, "Parent")).toBe(scoreOf(general, "Parent"));
    expect(scoreOf(overUs, "Funder")).toBeCloseTo(scoreOf(general, "Funder") + Math.log10(0.8), 1);
    expect(scoreOf(overUs, "Friend")).toBeCloseTo(scoreOf(general, "Friend") + Math.log10(0.25), 1);
  });

  it("equals general power when no organization is set", () => {
    expect(computePowerOverUs(cards, relations, null, NOW)).toEqual(computePower(cards, relations, NOW));
  });
});
