import { describe, expect, it } from "vitest";
import { articleActions, articleSections, outlineProblems, sentenceCasePlan, type ArticleKnowledge, type ArticlePlan } from "./articlePlan";

const knowledge: ArticleKnowledge = {
  entity: { id: "entity", type: "company", key: "exampleco", name: "ExampleCo" },
  units: [
    { unitId: "u1", revisionId: "r1", content: "ExampleCo runs a health and safety program for all staff.", kind: "fact", epistemicStatus: "established" },
    { unitId: "u2", revisionId: "r2", content: "ExampleCo requires eye protection.", kind: "procedure", epistemicStatus: "established" },
    { unitId: "u3", revisionId: "r3", content: "ExampleCo requires incidents to be reported.", kind: "procedure", epistemicStatus: "established" },
    { unitId: "u4", revisionId: "r4", content: "ExampleCo reviews each incident report within a week.", kind: "procedure", epistemicStatus: "established" },
  ],
};
const plan: ArticlePlan = { title: "Health and safety at ExampleCo", introduction: ["C1"], sections: [{ title: "Protective equipment", claims: ["C2"] }, { title: "Incident reporting", claims: ["C3", "C4"] }] };

describe("content-based article planning", () => {
  it("uses the topic title and gives the introduction and each section their own claims", () => {
    const [action] = articleActions(plan, knowledge, null, []);
    expect(action).toMatchObject({ type: "create_page", input: { title: "Health and safety at ExampleCo", entityId: "entity" } });
    expect(articleSections(plan, knowledge).map((section) => [section.title, section.query.unitIds])).toEqual([
      ["Overview", ["u1"]], ["Protective equipment", ["u2"]], ["Incident reporting", ["u3", "u4"]],
    ]);
  });

  it("states a claim listed in both the introduction and a section only in the introduction, dropping a section left empty", () => {
    const repeating: ArticlePlan = { ...plan, introduction: ["C1", "C2"], sections: [{ title: "Equipment", claims: ["C2"] }, { title: "Incident reporting", claims: ["C1", "C3", "C4"] }] };
    expect(articleSections(repeating, knowledge).map((section) => [section.title, section.query.unitIds])).toEqual([
      ["Overview", ["u1", "u2"]], ["Incident reporting", ["u3", "u4"]],
    ]);
  });

  it("rejects invented references instead of attaching unrelated claims", () => {
    expect(() => articleSections({ ...plan, introduction: ["C99"] }, knowledge)).toThrow("unknown claim");
  });

  it("rejects a claim placed nowhere rather than losing knowledge, and accepts one placed only in the introduction", () => {
    expect(() => articleSections({ ...plan, sections: [plan.sections[0]!] }, knowledge)).toThrow("omitted 2 claims");
    expect(() => articleSections({ ...plan, introduction: ["C1", "C3", "C4"], sections: [plan.sections[0]!] }, knowledge)).not.toThrow();
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

  it("flags a topic section named like the introduction", () => {
    expect(outlineProblems({ ...sixClaims, sections: [{ title: "Overview and origins", claims: ["C4"] }, { title: "Reception", claims: ["C5", "C6"] }] })).toEqual([expect.stringContaining("restates the introduction")]);
    expect(outlineProblems({ ...sixClaims, sections: [{ title: "Website", claims: ["C4"] }, { title: "Reception", claims: ["C5", "C6"] }] })).toEqual([]);
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
