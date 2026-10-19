import { expect, it } from "vitest";
import { validateTabPlan, tabOrganizationEvidence, type TabLayout, type TabPlan } from "./tabOrganization";

const layout: TabLayout = { tabs: [{ id: "t", name: "Reference", description: "Reference subjects", root_ids: ["r"] }], roots: [{ id: "r", name: "Personality", path: "Personality", context_entity_id: null }] };
const plan: TabPlan = { reason: "Group by subject", tabs: [{ id: "t", name: "Reference", description: "Reference subjects", rootIds: [] }, { id: null, name: "Psychology", description: "Psychology and personality", rootIds: ["r"] }] };

it("allows a new subject tab without changing roots or existing tab definitions", () => {
  expect(() => validateTabPlan(plan, layout)).not.toThrow();
  expect(() => validateTabPlan({ ...plan, tabs: plan.tabs.slice(1) }, layout)).toThrow("Keep all");
  expect(() => validateTabPlan({ ...plan, tabs: plan.tabs.map((t, i) => i ? t : { ...t, name: "Internal" }) }, layout)).toThrow("unchanged");
});

it("rejects missing, duplicated, foreign roots and synonymous casing of tab names", () => {
  expect(() => validateTabPlan({ ...plan, tabs: plan.tabs.map(t => ({ ...t, rootIds: [] })) }, layout)).toThrow();
  expect(() => validateTabPlan({ ...plan, tabs: plan.tabs.map(t => ({ ...t, rootIds: ["r"] })) }, layout)).toThrow("exactly one");
  expect(() => validateTabPlan({ ...plan, tabs: [...plan.tabs, { ...plan.tabs[1]!, name: "Foreign", rootIds: ["foreign"] }] }, layout)).toThrow();
  expect(() => validateTabPlan({ ...plan, tabs: [...plan.tabs, { ...plan.tabs[1]!, name: "PSYCHOLOGY" }] }, layout)).toThrow("unique");
});

it("samples different branches and excludes retired evidence", () => {
  const evidence = tabOrganizationEvidence(layout, {
    domains: ["Personality", "Personality/Types", "Personality/Growth"].map((path, i) => ({ id: `d${i}`, name: path, path, parent_id: i ? "d0" : null, retired_at: null, context_entity_id: null })),
    claims: Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, revisionId: `v${i}`, content: `Full claim ${i}`, retiredAt: i === 29 ? "retired" : null })),
    unitDomains: Array.from({ length: 30 }, (_, i) => ({ unit_id: `c${i}`, domain_id: i < 28 ? "d1" : "d2" })),
  });
  expect(evidence.roots[0]!.samples).toContainEqual({ path: "Personality/Growth", content: "Full claim 28" });
  expect(evidence.roots[0]!.samples.some(s => s.content === "Full claim 29")).toBe(false);
  expect(evidence.roots[0]!.branches).toHaveLength(3);
});
