import { defaultSkill } from "@/lib/ai/skills/defaults";
import type { SkillLibrary } from "@/lib/ai/skills/types";
import { describe, expect, it } from "vitest";
import { flowRole } from "./flowModel";

const library: SkillLibrary = { skills: [], assignments: [] };
describe("workflow role labels reflect effective instructions", () => {
  it("shows the built-in skill when there is no assignment", () => {
    const role = flowRole("plan_articles", library);
    expect(role.name).toBe("Planner");
    expect(role.skill).toBe(defaultSkill("plan_articles").name);
    expect(role.instructions).toBe(defaultSkill("plan_articles").instructions);
  });
  it("shows saved skill names, instructions, and versions", () => {
    const skill = { id: "custom", name: "Plain-language planning", description: "", instructions: "Keep it focused.", version: 7, builtin_key: null, archived_at: null, updated_at: "" };
    const role = flowRole("plan_articles", { skills: [skill], assignments: [{ stage: "plan_articles", skill_id: skill.id }] });
    expect(role).toMatchObject({ skill: skill.name, version: 7, instructions: skill.instructions });
  });
  it("does not show a default skill when a stage explicitly has none", () => {
    expect(flowRole("plan_articles", { ...library, assignments: [{ stage: "plan_articles", skill_id: null }] })).toMatchObject({ skill: "App rules only", version: undefined });
  });
  it("shows role overrides instead of the underlying assigned skill", () => {
    expect(flowRole("plan_articles", { ...library, roleInstructions: [{ role: "plan_articles", instructions: "My planner policy", version: 3 }] })).toMatchObject({ skill: "Custom role instructions", version: 3, instructions: "My planner policy" });
    expect(flowRole("reviewer", { ...library, roleInstructions: [{ role: "reviewer", instructions: "My review policy", version: 2 }] })).toMatchObject({ name: "Reviewer", skill: "Custom role instructions", version: 2, instructions: "My review policy" });
  });
  it("shows fixed role policies and flags unavailable assigned skills", () => {
    expect(flowRole("researcher", library)).toMatchObject({ name: "Researcher", skill: "Role policy", version: 1 });
    expect(flowRole("plan_articles", { ...library, assignments: [{ stage: "plan_articles", skill_id: "missing" }] }).skill).toBe("Assigned skill unavailable");
  });
});

// The displayed handoffs must follow the processing contract: definitions and
// the index finish before the one article pass.
describe("workflow diagrams match upload stage order", () => {
  it("keeps the detailed upload handoffs in runtime order", async () => {
    const { AI_FLOW } = await import("./aiFlowCanvas");
    const { KNOWLEDGE_STAGES, ARTICLE_STAGES, ENRICHMENT_STAGES } = await import("@/lib/ingest/workflowTypes");
    const ids: Record<string, string> = { duplicates: "deduplicator", glossary: "dictionary", expand: "definer", plan: "planner", pages: "writer" };
    const visible = [...KNOWLEDGE_STAGES, ...ARTICLE_STAGES, ...ENRICHMENT_STAGES].filter((stage) => stage !== "curate");
    const x = (id: string) => AI_FLOW.nodes.find((node) => node.id === (ids[id] ?? id))!.x;
    for (let i = 1; i < visible.length; i++) expect(x(visible[i]!)).toBeGreaterThan(x(visible[i - 1]!));
    const reviewer = AI_FLOW.nodes.find((node) => node.id === "reviewer")!;
    expect(reviewer.x).toBeLessThan(x("describe"));
  });
  it("gives every diagram edge existing endpoints", async () => {
    const { AI_FLOW } = await import("./aiFlowCanvas");
    const { ASSET_CANVAS, ILLUSTRATION_CANVAS, KNOWLEDGE_CANVAS, RESEARCH_CANVAS } = await import("./flowsCanvas");
    for (const diagram of [AI_FLOW, KNOWLEDGE_CANVAS, RESEARCH_CANVAS, ASSET_CANVAS, ILLUSTRATION_CANVAS]) {
      const ids = new Set(diagram.nodes.map((node) => node.id));
      for (const edge of diagram.edges) { expect(ids.has(edge.from)).toBe(true); expect(ids.has(edge.to)).toBe(true); }
      for (const node of diagram.nodes) if (node.store) expect(ids.has(node.store)).toBe(true);
    }
  });
});
