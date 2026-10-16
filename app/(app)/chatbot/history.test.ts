import { describe, expect, it } from "vitest";
import { readHistory, saveConversation } from "./history";

describe("Ask history", () => {
  it("preserves messages and references across storage round trips", () => {
    const messages = [{ role: "user" as const, content: "What did I save?" }, { role: "assistant" as const, content: "See [K1]", references: [{ id: "K1", title: "A note", kind: "Knowledge" as const, href: "/units/123", text: "Evidence" }] }];
    const saved = saveConversation([], "one", messages, 100);
    expect(readHistory(JSON.stringify(saved))[0]?.messages).toEqual(messages);
  });
  it("updates a continued chat without duplicating it and sorts it first", () => {
    const first = saveConversation([], "one", [{ role: "user", content: "First" }], 1);
    const second = saveConversation(first, "two", [{ role: "user", content: "Second" }], 2);
    const continued = saveConversation(second, "one", [{ role: "user", content: "First" }, { role: "assistant", content: "Answer" }], 3);
    expect(continued.map(chat => chat.id)).toEqual(["one", "two"]);
    expect(continued[0]?.messages).toHaveLength(2);
    expect(saveConversation(continued, "empty", [])).toEqual(continued);
  });
  it("rejects damaged history and unsafe reference links", () => {
    expect(readHistory(null)).toEqual([]);
    expect(() => readHistory("broken")).toThrow();
    const unsafe = saveConversation([], "one", [{ role: "assistant", content: "Bad", references: [{ id: "K1", title: "Bad", kind: "Knowledge", href: "javascript:alert(1)", text: "" }] }]);
    expect(() => readHistory(JSON.stringify(unsafe))).toThrow();
  });
});
