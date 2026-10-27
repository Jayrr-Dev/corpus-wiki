import { expect, it } from "vitest";
import { createDomainSeparator } from "./clusters";
import { createSimulation, nodeRadius, type SimLink, type SimNode } from "./physics";
import { DEFAULT_GRAPH_SETTINGS } from "./settings";

// Worst overlap between two dots, as a share of the smaller dot's radius (0 = none touch)
function worstOverlap(nodes: readonly SimNode[], nodeSize: number): number {
  let worst = 0;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!, b = nodes[j]!;
      const ra = nodeRadius(a, nodeSize), rb = nodeRadius(b, nodeSize);
      const overlap = ra + rb - Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0));
      if (overlap > 0) worst = Math.max(worst, overlap / Math.min(ra, rb));
    }
  }
  return worst;
}

it("keeps well-linked hubs in one subject from overlapping once settled", () => {
  // A few big hubs per subject, each with its own small satellites, all in nested domains
  const subjects = ["Root/Five/Levels", "Root/Five/Thinking", "Root/Five"];
  const nodes: SimNode[] = [];
  const links: SimLink[] = [];
  const add = (id: string, path: string, degree: number) => nodes.push({
    id, kind: "unit", label: id, text: "", href: "", createdAt: "", degree,
    domainPaths: [path], entityNames: [], unitKind: "fact", status: null,
  } as SimNode);
  subjects.forEach((path, s) => {
    for (let h = 0; h < 4; h++) {
      const hub = `${s}-hub-${h}`;
      add(hub, path, 24);
      for (let k = 0; k < 6; k++) {
        const leaf = `${hub}-${k}`;
        add(leaf, path, 1);
        links.push({ id: `${hub}>${leaf}`, source: hub, target: leaf, kind: "relates" } as unknown as SimLink);
      }
      // Hubs in a subject link to each other, which pulls them together
      for (let other = 0; other < h; other++) links.push({ id: `${hub}>${other}`, source: hub, target: `${s}-hub-${other}`, kind: "similar" } as unknown as SimLink);
    }
  });
  const nodeSize = DEFAULT_GRAPH_SETTINGS.display.nodeSize;
  const simulation = createSimulation(nodes, links, DEFAULT_GRAPH_SETTINGS.forces, nodeSize);
  const separate = createDomainSeparator(nodes, nodeSize, links);
  try {
    for (let tick = 0; tick < 300; tick++) { simulation.tick(); separate(); }
    expect(worstOverlap(nodes, nodeSize)).toBeLessThan(0.1);
  } finally { simulation.stop(); }
});
