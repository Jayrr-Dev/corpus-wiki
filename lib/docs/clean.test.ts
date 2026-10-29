import { describe, expect, it } from "vitest";
import { docSetsToRetire, planDocCleanup } from "./clean";
import type { DocSetSummary } from "./types";

function set(id: string, scopeId: string | null, extra: Partial<DocSetSummary> = {}): DocSetSummary {
  return {
    id, title: id, scopeKind: "topic", scopeId, coverage: 100, status: "ready", error: null,
    createdAt: "2026-10-01T00:00:00Z", updatedAt: "", pageCount: 3, stalePages: 0, ...extra,
  };
}

describe("planDocCleanup", () => {
  it("keeps the newest set per source and retires the rest", () => {
    const groups = planDocCleanup([
      set("old", "cse", { createdAt: "2026-10-01T00:00:00Z", pageCount: 6 }),
      set("new", "cse", { createdAt: "2026-10-03T00:00:00Z", pageCount: 2 }),
      set("mid", "cse", { createdAt: "2026-10-02T00:00:00Z", pageCount: 5 }),
      set("a1", "atm", { createdAt: "2026-10-01T00:00:00Z" }),
      set("a2", "atm", { createdAt: "2026-10-02T00:00:00Z" }),
      set("alone", "fire"),
    ]);
    expect(groups.map((group) => [group.keep.id, group.retire.map((s) => s.id)])).toEqual([
      ["new", ["mid", "old"]],
      ["a2", ["a1"]],
    ]);
    expect(docSetsToRetire(groups)).toEqual(["mid", "old", "a1"]);
  });

  it("prefers a ready set over a newer failed one", () => {
    const [group] = planDocCleanup([
      set("ready", "cse", { createdAt: "2026-10-01T00:00:00Z" }),
      set("failed", "cse", { createdAt: "2026-10-05T00:00:00Z", status: "failed" }),
    ]);
    expect(group!.keep.id).toBe("ready");
    expect(group!.retire.map((s) => s.id)).toEqual(["failed"]);
  });

  it("breaks a tie on age with more pages", () => {
    const [group] = planDocCleanup([set("small", "cse", { pageCount: 2 }), set("big", "cse", { pageCount: 6 })]);
    expect(group!.keep.id).toBe("big");
  });

  it("leaves a source alone while one of its sets is still being written", () => {
    expect(planDocCleanup([set("done", "cse"), set("busy", "cse", { status: "writing" })])).toEqual([]);
  });

  it("groups by source kind too, so glossary sets only match each other", () => {
    const groups = planDocCleanup([
      set("g1", null, { scopeKind: "glossary", createdAt: "2026-10-01T00:00:00Z" }),
      set("g2", null, { scopeKind: "glossary", createdAt: "2026-10-02T00:00:00Z" }),
      set("t", "x"),
      set("e", "x", { scopeKind: "entity" }),
    ]);
    expect(groups.map((group) => [group.keep.id, group.retire.map((s) => s.id)])).toEqual([["g2", ["g1"]]]);
  });

  it("finds nothing when every source has one set", () => {
    expect(planDocCleanup([set("a", "cse"), set("b", "atm")])).toEqual([]);
  });
});
