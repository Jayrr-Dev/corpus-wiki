import { expect, it } from "vitest";
import { clusterCircles, createContainment, packDomains } from "./clusters";
import { createSimulation, nodeRadius, type SimNode, type SimLink } from "./physics";
import { DEFAULT_GRAPH_SETTINGS } from "./settings";

it("pulls dots flung far away back into their own circles in one step", () => {
  const nodes = Array.from({length: 20}, (_, i) => ({
    id: String(i), domainPaths: [`Root/Subject ${i % 2}`], degree: 4,
    x: Math.sin(i * 2.3) * 1_000_000, y: Math.cos(i * 1.7) * 1_000_000,
  })) as SimNode[];
  createContainment(nodes, 1)();
  const { homes } = packDomains(nodes, 1);
  for (const node of nodes) {
    const home = homes.get(node.id)!;
    expect(Math.hypot(node.x! - home.x, node.y! - home.y) + nodeRadius(node, 1)).toBeLessThanOrEqual(home.r + 1e-6);
  }
});

it("keeps every dot of a large nested graph inside its own circle while settling", () => {
  const nodes: SimNode[] = Array.from({ length: 1800 }, (_, i) => ({
    id: String(i), kind: "unit", label: String(i), text: "", href: "",
    createdAt: "", degree: 4,
    domainPaths: [i % 7 === 0 ? `Root/Subject ${i % 20}` : i % 3 === 0 ? `Root/Subject ${i % 20}/Detail ${i % 90}` : `Root/Subject ${i % 20}/Detail ${i % 90}/Leaf ${i % 150}`],
    entityNames: [], unitKind: "fact", status: null,
  }));
  const links = nodes.flatMap((node, i) => [1, 4].map(offset => ({id:`${i}-${offset}`,source:node.id,target:nodes[(i + offset) % nodes.length]!.id,kind:"similar"}))) as SimLink[];
  const simulation = createSimulation(nodes, links, DEFAULT_GRAPH_SETTINGS.forces, 1);
  const contain = createContainment(nodes, 1);
  try {
    contain();
    for (let tick = 0; tick < 200; tick++) { simulation.tick(); contain(); }
    const { homes } = packDomains(nodes, 1);
    expect(nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
    for (const node of nodes) {
      const home = homes.get(node.id)!;
      expect(Math.hypot(node.x! - home.x, node.y! - home.y) + nodeRadius(node, 1)).toBeLessThanOrEqual(home.r + 1e-6);
    }
    // Packing sizes rings from the dots they hold, so the outer ring stays near the dots' own area
    expect(clusterCircles(nodes, 1)[0]!.r).toBeLessThan(5_000);
  } finally { simulation.stop(); }
});
