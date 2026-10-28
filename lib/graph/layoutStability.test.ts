import { expect, it } from "vitest";
import { clusterCircles, createContainment, packDomains } from "./clusters";
import {
  createSimulation,
  nodeRadius,
  type SimLink,
  type SimNode,
} from "./physics";
import { DEFAULT_GRAPH_SETTINGS } from "./settings";

it("pulls a hub's colored neighbors in and pushes an unlinked dot away", () => {
  const dot = (id: string, degree: number, x: number, y: number): SimNode => ({
    id,
    kind: "unit",
    label: id,
    text: "",
    href: "",
    createdAt: "",
    degree,
    domainPaths: [],
    entityNames: [],
    unitKind: "fact",
    status: null,
    x,
    y,
    vx: 0,
    vy: 0,
  });
  const hub = dot("hub", 6, 0, 0);
  const blue = [dot("b1", 1, 30, 0), dot("b2", 1, 0, 30)];
  const orange = [dot("o1", 1, -30, 0), dot("o2", 1, 0, -30)];
  const stranger = dot("stranger", 0, 12, 8);
  const links = [...blue, ...orange].map((node) => ({
    id: `hub-${node.id}`,
    source: hub.id,
    target: node.id,
    kind: "related_to",
  })) as SimLink[];
  const colors = new Map<string, string>([
    ["b1", "link"],
    ["b2", "link"],
    ["o1", "needs-you"],
    ["o2", "needs-you"],
  ]);
  const forces = { ...DEFAULT_GRAPH_SETTINGS.forces, cluster: 0 };
  const simulation = createSimulation(
    [hub, ...blue, ...orange, stranger],
    links,
    forces,
    1,
    "domain",
    (node) => colors.get(node.id) ?? null,
  );
  try {
    for (let tick = 0; tick < 250; tick++) simulation.tick();
    const distance = (node: SimNode) =>
      Math.hypot((node.x ?? 0) - (hub.x ?? 0), (node.y ?? 0) - (hub.y ?? 0));
    const neighbors = [...blue, ...orange].map(distance);
    const farthestNeighbor = Math.max(...neighbors);
    expect(distance(stranger)).toBeGreaterThan(farthestNeighbor);
    const pair = (a: SimNode, b: SimNode) =>
      Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0));
    expect(pair(blue[0]!, blue[1]!)).toBeLessThan(pair(blue[0]!, orange[0]!));
    expect(pair(orange[0]!, orange[1]!)).toBeLessThan(
      pair(orange[0]!, blue[0]!),
    );
  } finally {
    simulation.stop();
  }
});

it("lets a near link pull harder than a far one", () => {
  const dot = (id: string, x: number, y: number): SimNode => ({
    id,
    kind: "unit",
    label: id,
    text: "",
    href: "",
    createdAt: "",
    degree: 1,
    domainPaths: [],
    entityNames: [],
    unitKind: "fact",
    status: null,
    x,
    y,
    vx: 0,
    vy: 0,
  });
  const nearA = dot("near-a", 0, 0);
  const nearB = dot("near-b", 80, 0);
  const farA = dot("far-a", 0, 400);
  const farB = dot("far-b", 800, 400);
  const links = [
    { id: "near", source: nearA.id, target: nearB.id, kind: "related_to" },
    { id: "far", source: farA.id, target: farB.id, kind: "related_to" },
  ] as SimLink[];
  const forces = {
    ...DEFAULT_GRAPH_SETTINGS.forces,
    center: 0,
    repel: 0,
    link: 1,
    cluster: 0,
  };
  const simulation = createSimulation(
    [nearA, nearB, farA, farB],
    links,
    forces,
    1,
  );
  const gap = (a: SimNode, b: SimNode) =>
    Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0));
  const nearBefore = gap(nearA, nearB);
  const farBefore = gap(farA, farB);
  try {
    simulation.tick();
    const nearClosed = nearBefore - gap(nearA, nearB);
    const farClosed = farBefore - gap(farA, farB);
    expect(nearClosed).toBeGreaterThan(farClosed);
    expect(farClosed).toBeLessThan(nearClosed * 0.5);
  } finally {
    simulation.stop();
  }
});

it("pulls dots flung far away back into their own circles in one step", () => {
  const nodes = Array.from({ length: 20 }, (_, i) => ({
    id: String(i),
    kind: "unit",
    domainPaths: [`Root/Subject ${i % 2}`],
    degree: 4,
    x: Math.sin(i * 2.3) * 1_000_000,
    y: Math.cos(i * 1.7) * 1_000_000,
  })) as SimNode[];
  createContainment(nodes, 1)();
  const { homes } = packDomains(nodes, 1);
  for (const node of nodes) {
    const home = homes.get(node.id)!;
    expect(
      Math.hypot(node.x! - home.x, node.y! - home.y) + nodeRadius(node, 1),
    ).toBeLessThanOrEqual(home.r + 1e-6);
  }
});

it("keeps every dot of a large nested graph inside its own circle while settling", () => {
  const nodes: SimNode[] = Array.from({ length: 1800 }, (_, i) => ({
    id: String(i),
    kind: "unit",
    label: String(i),
    text: "",
    href: "",
    createdAt: "",
    degree: 4,
    domainPaths: [
      i % 7 === 0
        ? `Root/Subject ${i % 20}`
        : i % 3 === 0
          ? `Root/Subject ${i % 20}/Detail ${i % 90}`
          : `Root/Subject ${i % 20}/Detail ${i % 90}/Leaf ${i % 150}`,
    ],
    entityNames: [],
    unitKind: "fact",
    status: null,
  }));
  const links = nodes.flatMap((node, i) =>
    [1, 4].map((offset) => ({
      id: `${i}-${offset}`,
      source: node.id,
      target: nodes[(i + offset) % nodes.length]!.id,
      kind: "similar",
    })),
  ) as SimLink[];
  const simulation = createSimulation(
    nodes,
    links,
    DEFAULT_GRAPH_SETTINGS.forces,
    1,
  );
  const contain = createContainment(nodes, 1);
  try {
    contain();
    for (let tick = 0; tick < 200; tick++) {
      simulation.tick();
      contain();
    }
    const { homes } = packDomains(nodes, 1);
    expect(
      nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)),
    ).toBe(true);
    for (const node of nodes) {
      const home = homes.get(node.id)!;
      expect(
        Math.hypot(node.x! - home.x, node.y! - home.y) + nodeRadius(node, 1),
      ).toBeLessThanOrEqual(home.r + 1e-6);
    }
    // Packing sizes rings from the dots they hold, so the outer ring stays near the dots' own area
    expect(clusterCircles(nodes, 1)[0]!.r).toBeLessThan(5_000);
  } finally {
    simulation.stop();
  }
});
