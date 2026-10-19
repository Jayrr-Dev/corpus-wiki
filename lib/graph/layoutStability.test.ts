import { expect, it } from "vitest";
import { clusterCircles, createDomainSeparator } from "./clusters";
import { createSimulation, type SimNode, type SimLink } from "./physics";
import { DEFAULT_GRAPH_SETTINGS } from "./settings";

it("recovers stretched subjects before their rings push the rest of the graph away", () => {
  const nodes = Array.from({length: 20}, (_, i) => ({
    id: String(i), domainPaths: [`Root/Subject ${i % 2}`], degree: 4,
    x: Math.sin(i * 2.3) * 1_000_000, y: Math.cos(i * 1.7) * 1_000_000,
  })) as SimNode[];
  createDomainSeparator(nodes, 1)();
  for (const circle of clusterCircles(nodes, 1).filter(circle => circle.depth === 1)) {
    expect(circle.r).toBeLessThan(500);
  }
});

it("keeps linked parent summaries and nested subjects bounded while settling", () => {
  const nodes: SimNode[] = Array.from({ length: 1800 }, (_, i) => ({
    id: String(i), kind: "unit", label: String(i), text: "", href: "",
    createdAt: "", degree: 4,
    domainPaths: [i % 7 === 0 ? `Root/Subject ${i % 20}` : i % 3 === 0 ? `Root/Subject ${i % 20}/Detail ${i % 90}` : `Root/Subject ${i % 20}/Detail ${i % 90}/Leaf ${i % 150}`],
    entityNames: [], unitKind: "fact", status: null,
  }));
  const links = nodes.flatMap((node, i) => [1, 4].map(offset => ({id:`${i}-${offset}`,source:node.id,target:nodes[(i + offset) % nodes.length]!.id,kind:"similar"}))) as SimLink[];
  const simulation = createSimulation(nodes, links, DEFAULT_GRAPH_SETTINGS.forces, 1);
  const separate = createDomainSeparator(nodes, 1, links);
  try {
    for (let tick = 0; tick < 200; tick++) { simulation.tick(); separate(); }
    const radius = clusterCircles(nodes, 1)[0]!.r;
    expect(radius).toBeLessThan(20_000);
    expect(nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
  } finally { simulation.stop(); }
});
