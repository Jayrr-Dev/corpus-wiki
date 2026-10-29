import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { estimateCallCredits, promptCharacters } from "./credits";
import { creditsForCost, PLANS, PLANS_BY_ID, pricingFaqAnswer } from "./plans";

// =====================================================================
// THE PRICE LIST: the numbers from docs/monetization-plan.md, and the
// migration seeds public.plans with the same ones.
// =====================================================================

const MIGRATION = readFileSync(fileURLToPath(new URL("../../supabase/migrations/20261120010000_billing.sql", import.meta.url)), "utf8");

describe("plans", () => {
  it("matches the price list", () => {
    expect(PLANS.map((p) => [p.id, p.monthlyUsd, p.yearlyUsd, p.weeklyCredits, p.sessionCredits])).toEqual([
      ["free", 0, null, 300, 100],
      ["plus", 9, 90, 2_500, 800],
      ["pro", 24, 240, 7_500, 2_500],
      ["max", 79, null, 25_000, 8_000],
      ["team", 15, null, 5_000, null],
    ]);
    expect(PLANS_BY_ID.team).toMatchObject({ perSeat: true, seatMinimum: 3 });
  });

  it("is seeded into public.plans with the same numbers", () => {
    for (const plan of PLANS) {
      const row = new RegExp(String.raw`\('${plan.id}',\s*'${plan.name}',\s*${plan.monthlyUsd},\s*${plan.yearlyUsd ?? "null"},\s*${plan.perSeat},\s*${plan.seatMinimum},\s*${plan.weeklyCredits},\s*${plan.sessionCredits ?? "null"},`);
      expect(MIGRATION, plan.id).toMatch(row);
    }
  });

  it("keeps the migration on B-tree indexes (OrioleDB)", () => {
    expect(MIGRATION).not.toMatch(/using\s+(gin|gist|brin|hash|spgist)/i);
  });
});

describe("pricingFaqAnswer", () => {
  it("is written from the price list", () => {
    expect(pricingFaqAnswer()).toBe(
      "Free costs nothing and needs no card: 300 credits a week. Paid plans are Plus $9, Pro $24, Max $79 a month, and Team is $15 per seat (3 seats minimum). Plus and Pro cost two months less when paid yearly. Every plan has a weekly limit and a 5-hour limit, measured in credits.",
    );
  });
});

describe("credits", () => {
  it("is one credit per $0.001", () => {
    expect(creditsForCost(0.001)).toBe(1);
    expect(creditsForCost(0.15)).toBe(150);
    expect(creditsForCost(0.0000004)).toBe(0);
    expect(creditsForCost(null)).toBeNull();
  });

  it("reserves at least one credit, also for an unpriced model", () => {
    expect(estimateCallCredits({ model: "unknown/model", promptChars: 10_000, maxTokens: 8_000 })).toBe(1);
  });

  it("counts prompt characters across text and picture parts", () => {
    expect(promptCharacters([{ content: "abcd" }, { content: [{ type: "text", text: "ef" }, { type: "image_url" }] }])).toBe(4 + 2 + 1_000);
  });
});
