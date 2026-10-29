import { describe, expect, it } from "vitest";
import { MODULE_FLAG_KEYS, type ModuleFlagKey } from "@/lib/flags/registry";
import { ERROR_LOG_NAV, NAV_GROUPS, visibleNavGroups, visibleNavItems } from "./nav";

const hrefs = (groups: { href: string }[][]) => groups.flat().map((item) => item.href);
const MODULE_HREFS = ["/study", "/video", "/docs"];
// every sidebar module on except Study, Video and Docs (the defaults)
const BASE = MODULE_FLAG_KEYS.filter((key) => !["study", "video", "docs"].includes(key));
const without = (...off: ModuleFlagKey[]) => MODULE_FLAG_KEYS.filter((key) => !off.includes(key));

describe("module nav items", () => {
  it("sit in their own group right after read and ask", () => {
    expect(NAV_GROUPS[1]!.map((item) => [item.href, item.module])).toEqual([["/study", "study"], ["/video", "video"], ["/docs", "docs"]]);
    expect(NAV_GROUPS[1]!.some((item) => item.admin)).toBe(false);
  });

  it("give every link and the error log a module switch", () => {
    const keys = [...NAV_GROUPS.flat(), ERROR_LOG_NAV].map((item) => item.module);
    expect(keys.every(Boolean)).toBe(true);
    expect([...keys, "nav_mode_switch"].sort()).toEqual([...MODULE_FLAG_KEYS].sort());
  });

  it("are hidden while every module is off, and the empty group goes with them", () => {
    for (const admin of [true, false]) {
      const groups = visibleNavGroups({ admin, modules: BASE });
      expect(hrefs(groups).filter((href) => MODULE_HREFS.includes(href))).toEqual([]);
      expect(groups.every((items) => items.length > 0)).toBe(true);
    }
    expect(visibleNavGroups({ admin: true, modules: [] })).toEqual([]);
  });

  it("show only the modules that are on, in User mode too", () => {
    expect(hrefs(visibleNavGroups({ admin: false, modules: [...BASE, "video"] })).filter((href) => MODULE_HREFS.includes(href))).toEqual(["/video"]);
    expect(hrefs(visibleNavGroups({ admin: true, modules: [...BASE, "docs", "study"] })).filter((href) => MODULE_HREFS.includes(href))).toEqual(["/study", "/docs"]);
  });

  it("hide any other link whose module is off", () => {
    const shown = hrefs(visibleNavGroups({ admin: true, modules: without("graph", "decisions") }));
    expect(shown).not.toContain("/graph");
    expect(shown).not.toContain("/decisions");
    expect(shown).toContain("/pages");
  });

  it("leave admin-only filtering as it was", () => {
    const user = hrefs(visibleNavGroups({ admin: false, modules: BASE }));
    expect(user).toContain("/pages");
    expect(user).not.toContain("/units");
    expect(hrefs(visibleNavGroups({ admin: true, modules: BASE }))).toContain("/units");
  });

  it("filters a flat list the same way (the mobile top bar's titles)", () => {
    const all = NAV_GROUPS.flat();
    expect(visibleNavItems(all, { admin: true, modules: BASE }).map((item) => item.href)).not.toContain("/docs");
    expect(visibleNavItems(all, { admin: true, modules: [...BASE, "docs"] }).map((item) => item.href)).toContain("/docs");
  });
});
