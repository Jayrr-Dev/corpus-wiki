import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJson } from "@/lib/ai/chat";
import { planArticle, topicSections } from "./articlePlanner";
import type { ArticleKnowledge } from "./articlePlan";

vi.mock("@/lib/ai/chat", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/ai/chat")>()), chatJson: vi.fn() }));
const knowledge: ArticleKnowledge = {
  entity: { id: "entity", type: "company", key: "acme", name: "Acme" },
  units: [
    { unitId: "u1", revisionId: "r1", content: "Acme requires PPE.", kind: "procedure", epistemicStatus: "established" },
    { unitId: "u2", revisionId: "r2", content: "Acme reports incidents.", kind: "procedure", epistemicStatus: "established" },
  ],
};
const incomplete = { title: "Safety at Acme", introduction: ["C1"], sections: [{ title: "Equipment", claims: ["C1"] }] };
const complete = { ...incomplete, sections: [{ title: "Incident reporting", claims: ["C2"] }] };
const answer = (value: typeof incomplete) => ({ value, model: "test", tokensIn: 10, tokensOut: 20 });
const four: ArticleKnowledge = { ...knowledge, units: [...knowledge.units,
  { unitId: "u3", revisionId: "r3", content: "Acme trains staff.", kind: "procedure", epistemicStatus: "established" },
  { unitId: "u4", revisionId: "r4", content: "Acme audits sites.", kind: "procedure", epistemicStatus: "established" },
] };
beforeEach(() => vi.clearAllMocks());

describe("article planning completeness", () => {
  it("plans a sub-article from its supplied topic and claims before writing", async () => {
    vi.mocked(chatJson).mockResolvedValueOnce(answer(complete));
    await planArticle({ apiKey: "test" }, knowledge, "Safety communication");
    const input = JSON.parse(String(vi.mocked(chatJson).mock.calls[0]![1].messages[1]!.content));
    expect(input.subject).toBe("Safety communication");
    expect(input.claims.map((claim: { ref: string }) => claim.ref)).toEqual(["C1", "C2"]);
  });

  it("opens a one-topic article with its introduction claims instead of a separate opening", () => {
    expect(topicSections(complete, knowledge).map((section) => [section.title, section.query.unitIds])).toEqual([["Incident reporting", ["u1", "u2"]]]);
    const two = { ...complete, sections: [{ title: "Equipment", claims: ["C2", "C3"] }, { title: "Audits", claims: ["C4"] }] };
    expect(topicSections(two, four).map((section) => [section.title, section.query.unitIds])).toEqual([["Overview", ["u1"]], ["Equipment", ["u2", "u3"]], ["Audits", ["u4"]]]);
  });

  it("requests a correction when a claim is placed nowhere", async () => {
    vi.mocked(chatJson).mockResolvedValueOnce(answer(incomplete)).mockResolvedValueOnce(answer(complete));
    await expect(planArticle({ apiKey: "test" }, knowledge)).resolves.toEqual({ plan: complete, tokensIn: 20, tokensOut: 40 });
    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(vi.mocked(chatJson).mock.calls[1]?.[1].messages.at(-1)?.content).toContain("C2");
    expect(vi.mocked(chatJson).mock.calls[1]?.[1].messages.at(-1)?.content).toContain("exactly once");
  });

  it("fails without changing stored content if the corrected outline is still incomplete", async () => {
    vi.mocked(chatJson).mockResolvedValue(answer(incomplete));
    await expect(planArticle({ apiKey: "test" }, knowledge)).rejects.toThrow("omitted 1 claims (C2)");
    expect(chatJson).toHaveBeenCalledTimes(2);
  });

  it("asks once to rename a section that restates the introduction, then uses the outline in sentence case", async () => {
    const restating = { title: "Safety at Acme", introduction: ["C1"], sections: [{ title: "Overview of Rules", claims: ["C2"] }, { title: "Training and Audits", claims: ["C3", "C4"] }] };
    const renamed = { ...restating, sections: [{ title: "Incident Reporting", claims: ["C2"] }, { title: "Training and audits", claims: ["C3", "C4"] }] };
    vi.mocked(chatJson).mockResolvedValueOnce(answer(restating)).mockResolvedValueOnce(answer(renamed));
    const { plan } = await planArticle({ apiKey: "test" }, four);
    expect(vi.mocked(chatJson).mock.calls[1]?.[1].messages.at(-1)?.content).toContain("restates the introduction");
    expect(plan.sections.map((section) => section.title)).toEqual(["Incident reporting", "Training and audits"]);
  });

  it("uses a second outline that still restates the introduction rather than failing the page", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const restating = { title: "Safety at Acme", introduction: ["C1"], sections: [{ title: "Overview of rules", claims: ["C2"] }] };
    vi.mocked(chatJson).mockResolvedValue(answer(restating));
    await expect(planArticle({ apiKey: "test" }, knowledge)).resolves.toMatchObject({ plan: restating });
    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith("Article outline still repeats its introduction", expect.anything());
    warn.mockRestore();
  });
});
