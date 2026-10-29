import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import { defaultFeatureFlags, enabledModuleFlags, FEATURE_FLAG_KEYS, FEATURE_FLAGS, FEATURE_ONLY_KEYS, type FeatureFlagKey, isFeatureFlagKey, MODULE_FLAG_KEYS, resolveFeatureFlags } from "./registry";

const MODULES = ["pages", "graph", "glossary", "stakeholders", "ask", "study", "video", "docs", "upload", "sources", "assets", "knowledge", "changes", "decisions", "exceptions", "domains", "entities", "workflow", "agent_roles", "error_log", "nav_mode_switch"] as const;
const FEATURES = ["billing", "legal_pages", "audio_ingest", "chat_import", "gmail_import"] as const;
// every sidebar module starts on except the knowledge modules
const defaults = () => ({ ...Object.fromEntries(FEATURES.map((key) => [key, false])), ...Object.fromEntries(MODULES.map((key) => [key, !["study", "video", "docs"].includes(key)])) });

describe("feature flag registry", () => {
  it("registers the features, then every sidebar module in sidebar order", () => {
    expect(FEATURE_FLAG_KEYS).toEqual([...FEATURES, ...MODULES]);
    expect(FEATURE_ONLY_KEYS).toEqual(FEATURES);
    expect(MODULE_FLAG_KEYS).toEqual(MODULES);
  });

  it("starts every feature off, Study, Video and Docs too, and the other sidebar modules on", () => {
    for (const key of FEATURE_ONLY_KEYS) expect(FEATURE_FLAGS[key].defaultEnabled).toBe(false);
    expect(defaultFeatureFlags()).toEqual(defaults());
  });

  it("lists the sidebar modules that are on, in sidebar order", () => {
    expect(enabledModuleFlags(resolveFeatureFlags({ pages: false, docs: true, billing: true }))).toEqual(MODULES.filter((key) => !["pages", "study", "video"].includes(key)));
  });

  it("gives every flag a label and a one-line description", () => {
    for (const key of FEATURE_FLAG_KEYS) {
      const { label, description } = FEATURE_FLAGS[key];
      expect(label.trim().length).toBeGreaterThan(0);
      expect(description.trim().length).toBeGreaterThan(0);
      expect(description).not.toMatch(/\n/);
      expect(description.split(/\s+/).length).toBeLessThanOrEqual(14);
    }
  });

  it("uses keys the database accepts", () => {
    for (const key of FEATURE_FLAG_KEYS) expect(key).toMatch(/^[a-z][a-z0-9_]{0,62}$/);
  });

  it("knows only registered keys", () => {
    expect(isFeatureFlagKey("billing")).toBe(true);
    expect(isFeatureFlagKey("Billing")).toBe(false);
    expect(isFeatureFlagKey("toString")).toBe(false);
    expect(isFeatureFlagKey("__proto__")).toBe(false);
    expect(isFeatureFlagKey(1)).toBe(false);
    expect(isFeatureFlagKey(null)).toBe(false);
  });

  it("resolves saved values over the defaults, dropping unknown keys and anything but true", () => {
    expect(resolveFeatureFlags({ billing: true, gmail_import: "yes", chat_import: false, graph: false, ask: "no", nope: true })).toEqual({
      ...defaults(), billing: true, graph: false, ask: false,
    });
    for (const saved of [null, undefined, "x", 3, [], [true]]) expect(resolveFeatureFlags(saved)).toEqual(defaultFeatureFlags());
  });

  it("types the keys so an unknown one fails typecheck", () => {
    expectTypeOf<FeatureFlagKey>().toEqualTypeOf<(typeof FEATURES)[number] | (typeof MODULES)[number]>();
    // @ts-expect-error: not a registered flag
    const unknown: FeatureFlagKey = "dark_launch";
    expect(isFeatureFlagKey(unknown)).toBe(false);
  });
});

describe("feature flag migration", () => {
  const sql = readFileSync(fileURLToPath(new URL("../../supabase/migrations/20261120000000_feature_flags.sql", import.meta.url)), "utf8");

  it("creates the table with a text key, an off-by-default switch and updated_at", () => {
    expect(sql).toMatch(/create table public\.feature_flags \(\s*key text primary key/);
    expect(sql).toMatch(/enabled boolean not null default false/);
    expect(sql).toMatch(/updated_at timestamptz not null default now\(\)/);
  });

  it("adds no non-B-tree index (OrioleDB)", () => {
    expect(sql).not.toMatch(/using\s+(gin|gist|brin|hash|spgist)/i);
  });

  it("leaves the monetization switch alone", () => {
    expect(sql).not.toMatch(/monetization_enabled|set_monetization_enabled|workspace_settings\s+(add|drop)/i);
  });
});
