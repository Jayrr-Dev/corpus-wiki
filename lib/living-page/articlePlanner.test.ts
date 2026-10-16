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
const incomplete = { title: "Safety at Acme", introduction: ["C1", "C2"], sections: [{ title: "Equipment", claims: ["C1"] }] };
const complete = { ...incomplete, sections: [...incomplete.sections, { title: "Incident reporting", claims: ["C2"] }] };
const answer = (value: typeof incomplete) => ({ value, model: "test", tokensIn: 10, tokensOut: 20 });
beforeEach(() => vi.clearAllMocks());

describe("article planning completeness", () => {
  it("plans a sub-article from its supplied topic and claims before writing", async () => {
    vi.mocked(chatJson).mockResolvedValueOnce(answer(complete));
    await planArticle({ apiKey: "test" }, knowledge, "Safety communication");
    const input = JSON.parse(String(vi.mocked(chatJson).mock.calls[0]![1].messages[1]!.content));
    expect(input.subject).toBe("Safety communication");
    expect(input.claims.map((claim: { ref: string }) => claim.ref)).toEqual(["C1", "C2"]);
  });

  it("avoids repeating a short topic as both introduction and body", () => {
    const short = { ...complete, sections: [{ title: "Safety meetings", claims: ["C1", "C2"] }] };
    expect(topicSections(short, knowledge).map((section) => section.title)).toEqual(["Safety meetings"]);
    expect(topicSections(complete, knowledge).map((section) => section.title)).toEqual(["Overview", "Equipment", "Incident reporting"]);
  });

  it("requests a correction when a claim appears only in the introduction", async () => {
    vi.mocked(chatJson).mockResolvedValueOnce(answer(incomplete)).mockResolvedValueOnce(answer(complete));
    await expect(planArticle({ apiKey: "test" }, knowledge)).resolves.toEqual({ plan: complete, tokensIn: 20, tokensOut: 40 });
    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(vi.mocked(chatJson).mock.calls[1]?.[1].messages.at(-1)?.content).toContain("C2");
  });

  it("fails without changing stored content if the corrected outline is still incomplete", async () => {
    vi.mocked(chatJson).mockResolvedValue(answer(incomplete));
    await expect(planArticle({ apiKey: "test" }, knowledge)).rejects.toThrow("omitted 1 claims (C2)");
    expect(chatJson).toHaveBeenCalledTimes(2);
  });

  it("asks once to restructure a section that repeats the introduction, then uses the outline in sentence case", async () => {
    const four: ArticleKnowledge = { ...knowledge, units: [...knowledge.units,
      { unitId: "u3", revisionId: "r3", content: "Acme trains staff.", kind: "procedure", epistemicStatus: "established" },
      { unitId: "u4", revisionId: "r4", content: "Acme audits sites.", kind: "procedure", epistemicStatus: "established" },
    ] };
    const repeating = { title: "Safety at Acme", introduction: ["C1", "C2"], sections: [{ title: "Key Rules", claims: ["C1", "C2"] }, { title: "Training and Audits", claims: ["C3", "C4"] }] };
    const spread = { ...repeating, sections: [{ title: "Equipment and Training", claims: ["C1", "C3"] }, { title: "Reporting and audits", claims: ["C2", "C4"] }] };
    vi.mocked(chatJson).mockResolvedValueOnce(answer(repeating)).mockResolvedValueOnce(answer(spread));
    const { plan } = await planArticle({ apiKey: "test" }, four);
    expect(vi.mocked(chatJson).mock.calls[1]?.[1].messages.at(-1)?.content).toContain("repeats the introduction");
    expect(plan.sections.map((section) => section.title)).toEqual(["Equipment and training", "Reporting and audits"]);
  });

  it("uses a second outline that still repeats the introduction rather than failing the page", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const repeating = { title: "Safety at Acme", introduction: ["C1"], sections: [{ title: "Overview of rules", claims: ["C1"] }, { title: "Reporting", claims: ["C2"] }] };
    vi.mocked(chatJson).mockResolvedValue(answer(repeating));
    await expect(planArticle({ apiKey: "test" }, knowledge)).resolves.toMatchObject({ plan: repeating });
    expect(chatJson).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith("Article outline still repeats its introduction", expect.anything());
    warn.mockRestore();
  });
});
