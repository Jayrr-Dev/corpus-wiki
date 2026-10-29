import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import { defaultFeatureFlags, FEATURE_FLAG_KEYS, FEATURE_FLAGS, type FeatureFlagKey, isFeatureFlagKey, resolveFeatureFlags } from "./registry";

describe("feature flag registry", () => {
  it("registers billing, legal pages, audio ingest, chat import, Gmail import, Study, Video and Docs", () => {
    expect(FEATURE_FLAG_KEYS).toEqual(["billing", "audio_ingest", "chat_import", "gmail_import", "study", "video", "docs"]);
  });

  it("starts every flag off", () => {
    for (const key of FEATURE_FLAG_KEYS) expect(FEATURE_FLAGS[key].defaultEnabled).toBe(false);
    expect(Object.values(defaultFeatureFlags())).toEqual(FEATURE_FLAG_KEYS.map(() => false));
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
    expect(resolveFeatureFlags({ billing: true, gmail_import: "yes", chat_import: false, nope: true })).toEqual({
      billing: true, audio_ingest: false, chat_import: false, gmail_import: false, study: false, video: false, docs: false,
    });
    for (const saved of [null, undefined, "x", 3, [], [true]]) expect(resolveFeatureFlags(saved)).toEqual(defaultFeatureFlags());
  });

  it("types the keys so an unknown one fails typecheck", () => {
    expectTypeOf<FeatureFlagKey>().toEqualTypeOf<"billing" | "audio_ingest" | "chat_import" | "gmail_import" | "study" | "video" | "docs">();
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
