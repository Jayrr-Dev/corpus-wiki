import { describe, expect, it } from "vitest";
import type { StructureLinkType, StructureRelation } from "@/lib/stakeholders/structure";
import { buildStakeholderMap, MAX_NODES, mapGroup } from "./mapLayout";

const card = (entityId: string, extra: Partial<{ type: string; kind: string | null; isOurs: boolean }> = {}) =>
  ({ entityId, name: entityId, type: "organization", kind: null, logoUrl: null, isOurs: false, person: null, ...extra });
const link = (fromId: string, kind: StructureLinkType, toId: string, extra: Partial<StructureRelation> = {}): StructureRelation =>
  ({ fromId, toId, link: kind, title: null, seniority: null, share: null, current: true, since: null, until: null, asOf: null, unitIds: [], ...extra });
const noScore = () => 0;

describe("mapGroup", () => {
  it("reads free-text kinds down to three groups", () => {
    expect(mapGroup({ type: "organization", kind: "government agency", person: null })).toBe("government");
    expect(mapGroup({ type: "organization", kind: "supplier", person: null })).toBe("organization");
    expect(mapGroup({ type: "person", kind: null, person: null })).toBe("person");
    expect(mapGroup({ type: "organization", kind: "role", person: null })).toBe("person");
    expect(mapGroup({ type: "organization", kind: null, person: { title: "CEO" } })).toBe("person");
  });
});

describe("buildStakeholderMap", () => {
  it("draws one line per pair and labels it with the link", () => {
    const map = buildStakeholderMap([card("A"), card("B")], [link("A", "contracts_with", "B"), link("B", "part_of", "A")], noScore);
    expect(map.edges).toHaveLength(1);
    expect(map.edges[0]).toMatchObject({ fromId: "B", toId: "A", label: "part of", pressure: false });
  });

  it("marks links that cross between organizations as pressure", () => {
    const map = buildStakeholderMap([card("A"), card("B")], [link("A", "regulates", "B")], noScore);
    expect(map.edges[0]).toMatchObject({ label: "regulates", pressure: true });
  });

  it("leaves out former links and lists who is left with none", () => {
    const map = buildStakeholderMap([card("A"), card("B"), card("C")], [
      link("A", "works_in", "B", { current: false }), link("A", "leads", "C", { until: "2021" }),
    ], noScore);
    expect(map.nodes).toEqual([]);
    expect(map.edges).toEqual([]);
    expect(map.loose.map((entry) => entry.name)).toEqual(["A", "B", "C"]);
  });

  it("ignores links to stakeholders that are not shown", () => {
    const map = buildStakeholderMap([card("A")], [link("A", "funds", "Hidden")], noScore);
    expect(map.edges).toEqual([]);
    expect(map.loose.map((entry) => entry.name)).toEqual(["A"]);
  });

  it("puts our organization in the middle, whatever its power", () => {
    const cards = [card("Big"), card("Us", { isOurs: true })];
    const map = buildStakeholderMap(cards, [link("Big", "regulates", "Us")], (id) => (id === "Big" ? 100 : 1));
    const centre = map.nodes.find((node) => node.centre)!;
    expect(centre.card.name).toBe("Us");
    expect([centre.x, centre.y]).toEqual([map.width / 2, map.height / 2]);
  });

  it("falls back to the most powerful stakeholder in the middle", () => {
    const map = buildStakeholderMap([card("Small"), card("Big")], [link("Small", "part_of", "Big")], (id) => (id === "Big" ? 100 : 1));
    expect(map.nodes.find((node) => node.centre)?.card.name).toBe("Big");
  });

  it("keeps the strongest stakeholders and counts the rest", () => {
    const hub = card("Hub", { isOurs: true });
    const others = Array.from({ length: MAX_NODES + 5 }, (_, index) => card(`Org ${index}`));
    const map = buildStakeholderMap([hub, ...others], others.map((other) => link(other.entityId, "part_of", "Hub")), noScore);
    expect(map.nodes).toHaveLength(MAX_NODES);
    expect(map.edges).toHaveLength(MAX_NODES - 1);
    expect(map.left).toBe(6);
  });

  it("keeps every dot inside the frame and apart from the others", () => {
    const cards = ["A", "B", "C", "D", "E", "F", "G"].map((name) => card(name));
    const map = buildStakeholderMap(cards, cards.slice(1).map((other) => link(other.entityId, "part_of", "A")), noScore);
    for (const node of map.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(map.width);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(map.height);
      for (const other of map.nodes) {
        if (other !== node) expect(Math.hypot(node.x - other.x, node.y - other.y)).toBeGreaterThan(node.r + other.r);
      }
    }
  });
});
