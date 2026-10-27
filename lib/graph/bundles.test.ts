import { describe, expect, it } from "vitest";
import { routeDomains, straightenRoute } from "./bundles";

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
