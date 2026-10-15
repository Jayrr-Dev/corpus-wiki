import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJson } from "@/lib/ai/chat";
import { planArticle } from "./articlePlanner";
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
});
