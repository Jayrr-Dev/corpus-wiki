import { expect, it } from "vitest";
import { createContainment, packDomains } from "./clusters";
import type { SimNode } from "./physics";

function fixture(count: number): SimNode[] {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i), kind: "unit", label: String(i), text: "", href: "",
    createdAt: "", degree: 2, domainPaths: [`Root ${i % 6}/Branch ${i % 18}/Leaf ${i % 54}`],
    entityNames: [], unitKind: "fact", status: null,
    x: Math.sin(i * 1.23) * 500, y: Math.cos(i * 2.34) * 500,
  }));
}

it("packs once per set of dots and reuses it as positions and pins change", () => {
  const nodes = fixture(540);
  let reads = 0;
  for (const node of nodes) {
    const paths = node.domainPaths;
    Object.defineProperty(node, "domainPaths", { get: () => { reads++; return paths; } });
  }
  const contain = createContainment(nodes, 1);
  const packed = reads;
  expect(packed).toBeGreaterThan(0);
  contain();
  nodes[0]!.fx = 10_000;
  nodes[0]!.fy = 10_000;
  nodes[0]!.x = 10_000;
  nodes[0]!.y = 10_000;
  contain();
  expect(packDomains(nodes, 1)).toBe(packDomains(nodes, 1));
  expect(reads).toBe(packed);
  // A dragged dot stays where the pointer holds it
  expect({ x: nodes[0]!.x, y: nodes[0]!.y }).toEqual({ x: 10_000, y: 10_000 });
});
