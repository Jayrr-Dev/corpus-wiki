import { describe, expect, it } from "vitest";
import { NAV_GROUPS, visibleNavGroups, visibleNavItems } from "./nav";

const hrefs = (groups: { href: string }[][]) => groups.flat().map((item) => item.href);
const MODULE_HREFS = ["/study", "/video", "/docs"];

describe("module nav items", () => {
  it("sit in their own group right after read and ask", () => {
    expect(NAV_GROUPS[1]!.map((item) => [item.href, item.module])).toEqual([["/study", "study"], ["/video", "video"], ["/docs", "docs"]]);
    expect(NAV_GROUPS[1]!.some((item) => item.admin)).toBe(false);
  });

  it("are hidden while every module is off, and the empty group goes with them", () => {
    for (const admin of [true, false]) {
      const groups = visibleNavGroups({ admin, modules: [] });
      expect(hrefs(groups).filter((href) => MODULE_HREFS.includes(href))).toEqual([]);
      expect(groups.every((items) => items.length > 0)).toBe(true);
    }
  });

  it("show only the modules that are on, in User mode too", () => {
    expect(hrefs(visibleNavGroups({ admin: false, modules: ["video"] })).filter((href) => MODULE_HREFS.includes(href))).toEqual(["/video"]);
    expect(hrefs(visibleNavGroups({ admin: true, modules: ["docs", "study"] })).filter((href) => MODULE_HREFS.includes(href))).toEqual(["/study", "/docs"]);
  });

  it("leave admin-only filtering as it was", () => {
    const user = hrefs(visibleNavGroups({ admin: false, modules: [] }));
    expect(user).toContain("/pages");
    expect(user).not.toContain("/units");
    expect(hrefs(visibleNavGroups({ admin: true, modules: [] }))).toContain("/units");
  });

  it("filters a flat list the same way (the mobile top bar's titles)", () => {
    const all = NAV_GROUPS.flat();
    expect(visibleNavItems(all, { admin: true, modules: [] }).map((item) => item.href)).not.toContain("/docs");
    expect(visibleNavItems(all, { admin: true, modules: ["docs"] }).map((item) => item.href)).toContain("/docs");
  });
});
