import { describe, expect, it } from "vitest";
import { articleActions, articleSections, type ArticleKnowledge, type ArticlePlan } from "./articlePlan";

const knowledge: ArticleKnowledge = {
  entity: { id: "entity", type: "company", key: "exampleco", name: "ExampleCo" },
  units: [
    { unitId: "u1", revisionId: "r1", content: "ExampleCo requires eye protection.", kind: "procedure", epistemicStatus: "established" },
    { unitId: "u2", revisionId: "r2", content: "ExampleCo requires incidents to be reported.", kind: "procedure", epistemicStatus: "established" },
  ],
};
const plan: ArticlePlan = { title: "Health and safety at ExampleCo", introduction: ["C1", "C2"], sections: [{ title: "Protective equipment", claims: ["C1"] }, { title: "Incident reporting", claims: ["C2"] }] };

describe("content-based article planning", () => {
  it("uses the topic title and selects each section's own claims", () => {
    const [action] = articleActions(plan, knowledge, null, []);
    expect(action).toMatchObject({ type: "create_page", input: { title: "Health and safety at ExampleCo", entityId: "entity" } });
    expect(articleSections(plan, knowledge).map((section) => [section.title, section.query.unitIds])).toEqual([
      ["Overview", ["u1", "u2"]], ["Protective equipment", ["u1"]], ["Incident reporting", ["u2"]],
    ]);
  });

  it("rejects invented references instead of attaching unrelated claims", () => {
    expect(() => articleSections({ ...plan, introduction: ["C99"] }, knowledge)).toThrow("unknown claim");
  });

  it("rejects incomplete topic coverage rather than losing knowledge", () => {
    expect(() => articleSections({ ...plan, sections: [plan.sections[0]!] }, knowledge)).toThrow("omitted 1 claims");
  });

  it("restructures using reversible actions and preserves the page id and URL", () => {
    const actions = articleActions(plan, knowledge, "page", ["old-facts"]);
    expect(actions.map((action) => action.type)).toEqual(["rename_page", "retire_section", "create_section", "create_section", "create_section"]);
    expect(actions[0]).toMatchObject({ targetId: "page" });
    expect(actions[1]).toMatchObject({ targetId: "old-facts" });
    expect(actions.slice(2).every((action) => action.type === "create_section" && action.input.pageId === "page")).toBe(true);
  });
});
