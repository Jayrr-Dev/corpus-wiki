import { describe, expect, it } from "vitest";
import { articleActions, articleSections, outlineProblems, sentenceCasePlan, type ArticleKnowledge, type ArticlePlan } from "./articlePlan";

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

describe("outline quality", () => {
  const sixClaims = { title: "Time Cube", introduction: ["C1", "C2", "C3"] };

  it("flags a topic section that repeats the introduction or is named like it", () => {
    expect(outlineProblems({ ...sixClaims, sections: [{ title: "Origins", claims: ["C1", "C2", "C3"] }, { title: "Reception", claims: ["C4", "C5", "C6"] }] })).toEqual([expect.stringContaining("3 of its 3 claims")]);
    expect(outlineProblems({ ...sixClaims, sections: [{ title: "Overview and origins", claims: ["C4"] }, { title: "Reception", claims: ["C1", "C2", "C3", "C5", "C6"] }] })).toEqual([expect.stringContaining("restates the introduction")]);
  });

  it("allows introduction claims spread over topics, single-claim sections and one-section articles", () => {
    expect(outlineProblems({ ...sixClaims, sections: [{ title: "Website", claims: ["C1", "C4", "C5"] }, { title: "Reception", claims: ["C2", "C3", "C6"] }] })).toEqual([]);
    expect(outlineProblems(plan)).toEqual([]);
    expect(outlineProblems({ ...sixClaims, sections: [{ title: "Website", claims: ["C1", "C2", "C3", "C4", "C5", "C6"] }] })).toEqual([]);
  });

  it("writes the title and headings in sentence case, keeping proper names and acronyms", () => {
    const timeCube: ArticleKnowledge = { entity: { id: "e", type: "website", key: "time-cube", name: "Time Cube" }, units: [
      { unitId: "u1", revisionId: "r1", content: "Ray called his theory of time Time Cube.", kind: "fact", epistemicStatus: "established" },
      { unitId: "u2", revisionId: "r2", content: "Ray spoke at MIT and wrote that Greenwich Time is a conspiracy.", kind: "fact", epistemicStatus: "established" },
    ] };
    const cased = sentenceCasePlan({ title: "The Time Cube Website", introduction: ["C1"], sections: [
      { title: "Core Theory and Claims", claims: ["C1"] }, { title: "Talks at MIT and Ray's Greenwich Time Conspiracy", claims: ["C2"] }, { title: "public reception", claims: ["C2"] },
    ] }, timeCube);
    expect(cased.title).toBe("The Time Cube website");
    expect(cased.sections.map((section) => section.title)).toEqual(["Core theory and claims", "Talks at MIT and Ray's Greenwich Time conspiracy", "Public reception"]);
  });
});
