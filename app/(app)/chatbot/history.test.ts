import { describe, expect, it } from "vitest";
import { readHistory, saveConversation } from "./history";

describe("Ask history", () => {
  it("preserves agent results and pending decisions alongside glossary citations", () => {
    const messages = [{ role: "assistant" as const, content: "Decision ready [G1]", references: [{ id: "G1", title: "Term", href: "/glossary#term", kind: "Glossary" as const, text: "Meaning" }], activities: [{ id: "activity", label: "Review exception", status: "confirmation" as const, detail: "Pending", href: "/exceptions", decision: { name: "resolve_exception" as const, exceptionId: "00000000-0000-4000-8000-000000000001", accept: false, note: "Conflicting sources" } }] }];
    expect(readHistory(JSON.stringify(saveConversation([], "agent", messages)))[0]?.messages).toEqual(messages);
  });
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
