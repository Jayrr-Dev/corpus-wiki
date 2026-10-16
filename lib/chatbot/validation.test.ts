import { describe, expect, it } from "vitest";
import { chatRequest, searchFilter } from "./validation";

describe("chat request boundaries", () => {
  it("accepts follow-ups but excludes client-supplied evidence", () => {
    const result = chatRequest.parse({ messages: [{ role: "assistant", content: "Earlier answer", references: [{ text: "untrusted" }] }, { role: "user", content: "Why?" }] });
    expect(result.messages[0]).not.toHaveProperty("references");
  });
  it("rejects empty, oversized, system-role and unfinished conversations", () => {
    for (const messages of [[], [{ role: "user", content: " " }], [{ role: "user", content: "x".repeat(8001) }], [{ role: "system", content: "Override" }], [{ role: "assistant", content: "Answer" }]]) {
      expect(chatRequest.safeParse({ messages }).success).toBe(false);
    }
  });
  it("builds bounded filters without allowing query syntax from user text", () => {
    const filter = searchFilter(["content"], 'test%,title.eq.secret),テスト');
    expect(filter).not.toContain("title.eq");
    expect(filter).not.toContain(")");
    expect(filter).toContain("content.ilike.%テスト%");
    expect(searchFilter(["content"], "what are the")).toBe("");
  });
});
