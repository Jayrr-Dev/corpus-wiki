import { describe, expect, it } from "vitest";
import type { StructureLinkType, StructureRelation } from "@/lib/stakeholders/structure";
import { buildStructure, staleYear, yearsText } from "./structureTree";

const org = (entityId: string) => ({ entityId, name: entityId, type: "organization", person: null });
const person = (entityId: string) => ({ entityId, name: entityId, type: "person", person: null });
const link = (fromId: string, kind: StructureLinkType, toId: string, extra: Partial<StructureRelation> = {}): StructureRelation =>
  ({ fromId, toId, link: kind, title: null, seniority: null, share: null, current: true, since: null, until: null, asOf: null, unitIds: [], ...extra });

describe("buildStructure", () => {
  it("nests departments in their company, leaders before people", () => {
    const cards = [org("Acme"), org("Acme Finance"), person("Ann"), person("Bob"), person("Cat")];
    const { boxes, loose } = buildStructure(cards, [
      link("Acme Finance", "part_of", "Acme"),
      link("Ann", "leads", "Acme", { title: "CEO", seniority: "executive" }),
      link("Bob", "works_in", "Acme Finance", { title: "Analyst" }),
      link("Cat", "leads", "Acme Finance"),
    ]);
    expect(loose).toEqual([]);
    expect(boxes.map((box) => box.name)).toEqual(["Acme"]);
    const [acme] = boxes;
    expect(acme!.leaders.map((member) => [member.name, member.title])).toEqual([["Ann", "CEO"]]);
    expect(acme!.boxes.map((box) => box.name)).toEqual(["Acme Finance"]);
    expect(acme!.boxes[0]!.leaders.map((member) => member.name)).toEqual(["Cat"]);
    expect(acme!.boxes[0]!.people.map((member) => member.name)).toEqual(["Bob"]);
  });

  it("puts a person owner on top of the company and an organization owner around it", () => {
    const cards = [org("Holdco"), org("Sub"), person("Olga"), person("Lee")];
    const { boxes } = buildStructure(cards, [
      link("Sub", "owned_by", "Holdco"),
      link("Holdco", "owned_by", "Olga", { share: 1 }),
      link("Lee", "leads", "Holdco"),
    ]);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.leaders.map((member) => [member.name, member.role])).toEqual([["Olga", "owner"], ["Lee", "leader"]]);
    expect(boxes[0]!.boxes.map((box) => box.name)).toEqual(["Sub"]);
  });

  it("keeps the strongest role when one person has several links to a box", () => {
    const { boxes } = buildStructure([org("Co"), person("Pat")], [
      link("Pat", "works_in", "Co", { title: "Engineer" }),
      link("Pat", "leads", "Co", { title: "CTO" }),
    ]);
    expect(boxes[0]!.leaders.map((member) => [member.name, member.role, member.title])).toEqual([["Pat", "leader", "CTO"]]);
    expect(boxes[0]!.people).toEqual([]);
  });

  it("shows pressure links as lines, not nesting", () => {
    const { boxes, loose } = buildStructure([org("Regulator"), org("Utility")], [link("Regulator", "regulates", "Utility")]);
    expect(boxes.map((box) => box.name)).toEqual(["Regulator"]);
    expect(boxes[0]!.boxes).toEqual([]);
    expect(boxes[0]!.pressure).toEqual([{ link: "regulates", label: "Regulates", targetId: "Utility", targetName: "Utility" }]);
    expect(loose.map((entry) => entry.name)).toEqual(["Utility"]);
  });

  it("places a person who only reports to someone in the boss's box", () => {
    const { boxes } = buildStructure([org("Co"), person("Boss"), person("Dev")], [
      link("Boss", "leads", "Co"),
      link("Dev", "reports_to", "Boss"),
    ]);
    expect(boxes[0]!.people.map((member) => [member.name, member.reportsTo])).toEqual([["Dev", ["Boss"]]]);
  });

  it("breaks a loop of part-of links so every box still shows once", () => {
    const { boxes, loose } = buildStructure([org("A"), org("B")], [link("A", "part_of", "B"), link("B", "part_of", "A")]);
    expect(boxes.map((box) => box.name)).toEqual(["B"]);
    expect(boxes[0]!.boxes.map((box) => box.name)).toEqual(["A"]);
    expect(loose).toEqual([]);
  });

  it("keeps former people apart, and not again where they still sit", () => {
    const { boxes, loose } = buildStructure([org("Co"), person("Ex"), person("Now")], [
      link("Ex", "leads", "Co", { current: false, title: "Director", since: "2016", until: "2021-04" }),
      link("Now", "leads", "Co", { asOf: "2022-05-01" }),
      link("Now", "works_in", "Co", { current: false }),
    ]);
    expect(boxes[0]!.leaders.map((member) => [member.name, member.asOf])).toEqual([["Now", "2022-05-01"]]);
    expect(boxes[0]!.former.map((member) => [member.name, member.title, member.since, member.until])).toEqual([["Ex", "Director", "2016", "2021-04"]]);
    expect(loose).toEqual([]);
  });

  it("ignores links to unknown stakeholders and former organization nesting", () => {
    const { boxes, loose } = buildStructure([org("Co"), org("Old parent")], [
      link("Co", "part_of", "Old parent", { current: false }),
      link("Ghost", "works_in", "Co"),
    ]);
    expect(boxes).toEqual([]);
    expect(loose.map((entry) => entry.name)).toEqual(["Co", "Old parent"]);
  });

  it("orders boxes by rank, then name", () => {
    const rank = (id: string) => (id === "Zed" ? 10 : 0);
    const { boxes } = buildStructure([org("Alpha"), org("Zed"), org("X"), org("Y")], [link("Alpha", "funds", "X"), link("Zed", "funds", "Y")], rank);
    expect(boxes.map((box) => box.name)).toEqual(["Zed", "Alpha"]);
  });
});

describe("yearsText and staleYear", () => {
  it("names the years a seat was held", () => {
    expect(yearsText("2016", "2021-04-02")).toBe("2016 to 2021");
    expect(yearsText("2019-03", null)).toBe("from 2019");
    expect(yearsText(null, "2021")).toBe("until 2021");
    expect(yearsText(null, null)).toBeNull();
  });

  it("flags a link last confirmed before last year", () => {
    const now = new Date("2026-10-27");
    expect(staleYear("2022-05-01", now)).toBe("2022");
    expect(staleYear("2025-12-01", now)).toBeNull();
    expect(staleYear(null, now)).toBeNull();
  });
});
