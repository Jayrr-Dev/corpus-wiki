import { describe, expect, it } from "vitest";
import { isWritingSuggestion, newestWaiting, notStartedKnowledge, runningUploads, shouldPrompt, suggestionStage } from "./newKnowledge";

const unit = (id: string, created_at: string) => ({ id, created_at });

describe("suggestionStage", () => {
  it("counts an accepted suggestion and an article still being written as in progress", () => {
    expect(suggestionStage({ status: "accepting", signals: {} })).toBe("in_progress");
    expect(suggestionStage({ status: "applied", signals: { writing: true } })).toBe("in_progress");
  });

  it("keeps anything that needs an answer pending", () => {
    for (const status of ["pending", "failed", "stale"] as const) expect(suggestionStage({ status, signals: {} })).toBe("pending");
  });

  it("closes finished and dismissed suggestions", () => {
    expect(suggestionStage({ status: "applied", signals: { writing: false } })).toBe("closed");
    expect(suggestionStage({ status: "dismissed", signals: null })).toBe("closed");
    expect(isWritingSuggestion({ status: "dismissed", signals: { writing: true } })).toBe(false);
  });
});

describe("notStartedKnowledge", () => {
  it("leaves out skipped claims and finds the newest of the rest", () => {
    const units = [unit("a", "2026-10-01T00:00:00Z"), unit("b", "2026-10-03T00:00:00Z"), unit("c", "2026-10-02T00:00:00Z")];
    expect(notStartedKnowledge(units, ["b"])).toEqual({ count: 2, newestAt: "2026-10-02T00:00:00Z" });
  });

  it("reports nothing when every claim is skipped", () => {
    expect(notStartedKnowledge([unit("a", "2026-10-01T00:00:00Z")], ["a"])).toEqual({ count: 0, newestAt: null });
  });
});

describe("runningUploads", () => {
  it("counts an upload still writing articles after its claims were saved", () => {
    expect(runningUploads([{ id: "a", status: "applied" }], [{ event_id: "a", state: "running" }])).toBe(1);
  });

  it("does not count a finished workflow, even with an unfinished event status", () => {
    expect(runningUploads([{ id: "a", status: "reconciling" }], [{ event_id: "a", state: "complete" }])).toBe(0);
  });

  it("falls back to the event before its workflow exists", () => {
    expect(runningUploads([{ id: "a", status: "received" }, { id: "b", status: "failed" }], [])).toBe(1);
  });
});

describe("newestWaiting", () => {
  it("takes the later of the claims and the waiting suggestions", () => {
    expect(newestWaiting("2026-10-01T00:00:00Z", [{ created_at: "2026-10-02T00:00:00Z" }])).toBe("2026-10-02T00:00:00Z");
    expect(newestWaiting("2026-10-03T00:00:00Z", [{ created_at: "2026-10-02T00:00:00Z" }])).toBe("2026-10-03T00:00:00Z");
    expect(newestWaiting(null, [])).toBeNull();
  });
});

describe("shouldPrompt", () => {
  const newest = "2026-10-02T00:00:00Z";

  it("opens the first time and again for anything newer", () => {
    expect(shouldPrompt(newest, null, 0)).toBe(true);
    expect(shouldPrompt(newest, "2026-10-01T00:00:00Z", 0)).toBe(true);
  });

  it("stays closed for what the person already saw, or when nothing waits", () => {
    expect(shouldPrompt(newest, newest, 0)).toBe(false);
    expect(shouldPrompt("2026-10-01T00:00:00Z", newest, 0)).toBe(false);
    expect(shouldPrompt(null, null, 0)).toBe(false);
  });

  it("waits while an upload is running", () => {
    expect(shouldPrompt(newest, null, 1)).toBe(false);
  });
});
