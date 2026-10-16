import { describe, expect, it, vi } from "vitest";
import type { DbRpc } from "@/lib/db/rpc";
import { rebuildAfterEvent, rebuildSection, type SectionWriter } from "./index";
import type { SectionState } from "./types";

const state: SectionState = { sectionId: "s", title: "Overview", pageTitle: "ExampleCo", units: [], lines: [] };
const writer: SectionWriter = { name: "test", reviseSection: vi.fn() };

function fakeDb(claims: boolean[], finishes: object[]) {
  const call = vi.fn(async (fn: string, _args?: unknown) => {
    if (fn === "claim_section_build") return { claimed: claims.shift() ?? false };
    if (fn === "read_section_state") return state;
    if (fn === "finish_section_build") return { sectionId: "s", changeNoteId: null, ...finishes.shift() };
    return {};
  });
  return { db: { call: call as DbRpc["call"] }, names: () => call.mock.calls.map(([name]) => name), call };
}

describe("one build per section", () => {
  it("leaves a running build alone and does not touch the section", async () => {
    const { db, names } = fakeDb([false], []);
    expect(await rebuildSection(db, writer, "s", "event")).toBeNull();
    expect(names()).toEqual(["claim_section_build"]);
  });
  it("builds again for the event that asked while it ran", async () => {
    const { db, names, call } = fakeDb([true, true], [{ rebuildRequested: true, rebuildEventId: "later" }, { rebuildRequested: false }]);
    await rebuildSection(db, writer, "s", "first");
    expect(names().filter((name) => name === "finish_section_build")).toHaveLength(2);
    expect(call.mock.calls.filter(([name]) => name === "claim_section_build").map(([, args]) => (args as { p_event_id: string }).p_event_id)).toEqual(["first", "later"]);
  });
  it("reviews new knowledge only after all affected sections finish", async () => {
    const { db, call } = fakeDb([true, true], [{ rebuildRequested: false }, { rebuildRequested: false }]);
    const original = db.call;
    db.call = (async (name: string, args?: Record<string, unknown>) => name === "list_affected_sections"
      ? [{ sectionId: "a", pageId: "page" }, { sectionId: "b", pageId: "page" }]
      : original(name, args)) as DbRpc["call"];
    const reviewSections = vi.fn(async () => {
      expect(call.mock.calls.filter(([name]) => name === "finish_section_build")).toHaveLength(2);
    });
    await rebuildAfterEvent(db, { ...writer, reviewSections }, "new-knowledge");
    expect(reviewSections).toHaveBeenCalledExactlyOnceWith(["a", "b"]);
  });
});
