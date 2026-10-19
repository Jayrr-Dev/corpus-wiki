import { expect, it } from "vitest";
import { createDomainSeparator } from "./clusters";
import type { SimNode } from "./physics";

function fixture(count: number): SimNode[] {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i), kind: "unit", label: String(i), text: "", href: "",
    createdAt: "", degree: 2, domainPaths: [`Root ${i % 6}/Branch ${i % 18}/Leaf ${i % 54}`],
    entityNames: [], unitKind: "fact", status: null,
    x: Math.sin(i * 1.23) * 500, y: Math.cos(i * 2.34) * 500,
  }));
}

it("reads domain membership once and reuses it as positions and pins change", () => {
  const nodes = fixture(540);
  let reads = 0;
  for (const node of nodes) {
    const paths = node.domainPaths;
    Object.defineProperty(node, "domainPaths", { get: () => { reads++; return paths; } });
  }
  const separate = createDomainSeparator(nodes, 1);
  expect(reads).toBe(nodes.length);
  reads = 0;
  separate();
  nodes[0]!.fx = nodes[0]!.x;
  nodes[0]!.fy = nodes[0]!.y;
  const pinned = { x: nodes[0]!.x, y: nodes[0]!.y };
  separate();
  expect(reads).toBe(0);
  expect({ x: nodes[0]!.x, y: nodes[0]!.y }).toEqual(pinned);
});
