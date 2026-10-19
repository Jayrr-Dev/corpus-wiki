import { describe, expect, it, vi } from "vitest";
import { chatJson, type ChatMessage } from "@/lib/ai/chat";
import type { SectionReviseInput } from "../types";
import { TokenFactorySectionWriter } from "./tokenFactory";

vi.mock("@/lib/ai/chat", async (original) => ({ ...(await original<typeof import("@/lib/ai/chat")>()), chatJson: vi.fn() }));

const input: SectionReviseInput = {
  pageTitle: "Inspections", sectionTitle: "Schedule", lines: [], uncoveredUnitIds: ["a"], skipEditorialReview: true,
  units: [{ unitId: "a", revisionId: "a-r", content: "Inspections occur weekly.", kind: "fact", epistemicStatus: "established" }],
};

describe("section writer prompt caching", () => {
  it("resends the cached section request unchanged before each repair round", async () => {
    const sent: { name: string; messages: ChatMessage[] }[] = [];
    const drafts = [{ revise: [], retire: [], add: [] }, { revise: [], retire: [], add: [{ text: "Inspections occur weekly.", claims: ["C1"] }] }];
    vi.mocked(chatJson).mockImplementation(async (_settings, request) => {
      sent.push({ name: request.name, messages: request.messages.map((message) => ({ ...message }) as ChatMessage) });
      const value = request.name === "section_lines" ? drafts.shift() : { lines: [{ ref: "A1", supported: true, problem: "", missingCitations: [], unstatedCitations: [] }] };
      return { value, model: "test", tokensIn: 1, tokensOut: 1 } as never;
    });
    await new TokenFactorySectionWriter({ apiKey: "test" }).reviseSection(input);
    const [first, repair] = sent.filter((request) => request.name === "section_lines").map((request) => request.messages);
    expect(first!.map((message) => [message.role, message.cache === true])).toEqual([["system", false], ["system", false], ["user", true]]);
    // The repair round only appends after the cached prefix.
    expect(repair!.slice(0, first!.length)).toEqual(first);
    expect(repair!.slice(first!.length).map((message) => [message.role, message.cache === true])).toEqual([["user", false]]);
    expect(repair!.at(-1)!.content).toContain("C1");
  });
});
