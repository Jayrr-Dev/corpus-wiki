import { describe, expect, it } from "vitest";
import { routeControls, routeDomains, straightenRoute, summaryDomains } from "./bundles";

const at = (...domainPaths: string[]) => ({ domainPaths });

describe("routeDomains", () => {
  it("climbs to just below the shared domain, then down to the target's", () => {
    expect(routeDomains(at("Types/One/Anger"), at("Types/Six"))).toEqual(["Types/One/Anger", "Types/One", "Types/Six"]);
  });

  it("crosses between roots through both top-level domains", () => {
    expect(routeDomains(at("Types/One"), at("History"))).toEqual(["Types/One", "Types", "History"]);
  });

  it("goes straight down when one domain holds the other", () => {
    expect(routeDomains(at("Types"), at("Types/One/Anger"))).toEqual(["Types/One", "Types/One/Anger"]);
  });

  it("stays straight inside one domain or when an end has none", () => {
    expect(routeDomains(at("Types/One"), at("Types/One"))).toEqual([]);
    expect(routeDomains(at(), at("Types/One"))).toEqual([]);
  });

  it("uses the same primary domain as the cluster tree", () => {
    expect(routeDomains(at("Zeta", "Alpha/A"), at("Alpha/B"))).toEqual(["Alpha/A", "Alpha/B"]);
  });
});

describe("summaryDomains", () => {
  it("sums a link into the sibling domains where its route turns", () => {
    expect(summaryDomains(at("Types/One/Anger"), at("Types/Six/Fear"))).toEqual(["Types/One", "Types/Six"]);
  });

  it("uses the outer domain itself when it holds the other", () => {
    expect(summaryDomains(at("Types"), at("Types/One/Anger"))).toEqual(["Types", "Types/One"]);
  });

  it("leaves links inside one domain alone", () => {
    expect(summaryDomains(at("Types/One"), at("Types/One"))).toBeNull();
  });
});

describe("routeControls", () => {
  const circles = new Map([
    ["Types", { x: 0, y: 0, r: 100 }],
    ["Types/One", { x: -50, y: 0, r: 20 }],
    ["Types/Six", { x: 50, y: 0, r: 20 }],
    ["History", { x: 0, y: 300, r: 50 }],
  ]);

  it("turns at the facing edges of sibling circles, not their middles", () => {
    expect(routeControls(at("Types/One"), at("Types/Six"), circles)).toEqual([{ x: -30, y: 0 }, { x: 30, y: 0 }]);
  });

  it("passes through the middles of deeper circles on the way", () => {
    expect(routeControls(at("Types/One"), at("History"), circles)).toMatchObject([{ x: -50, y: 0 }, { x: 0, y: 100 }, { x: 0, y: 250 }]);
  });

  it("uses middles when one domain holds the other", () => {
    expect(routeControls(at("Types"), at("Types/Six"), circles)).toEqual([{ x: 50, y: 0, r: 20 }]);
  });
});

describe("straightenRoute", () => {
  const start = { x: 0, y: 0 }, end = { x: 100, y: 0 }, controls = [{ x: 50, y: 100 }];

  it("keeps the ends fixed", () => {
    const points = straightenRoute(start, controls, end, 0.85);
    expect(points[0]).toEqual(start);
    expect(points[2]).toEqual(end);
  });

  it("pulls controls toward the straight line as strength drops", () => {
    expect(straightenRoute(start, controls, end, 1)[1]).toEqual({ x: 50, y: 100 });
    expect(straightenRoute(start, controls, end, 0.5)[1]).toEqual({ x: 50, y: 50 });
    expect(straightenRoute(start, controls, end, 0)[1]).toEqual({ x: 50, y: 0 });
  });
});
