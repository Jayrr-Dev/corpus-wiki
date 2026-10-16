import { describe, expect, it } from "vitest";
import type { Tables } from "@/lib/database/types";
import { changeKind, filterChanges, matchesProposer, readChangeFilters } from "./filterChanges";

const changeSet = (overrides: Partial<Tables<"change_sets">>): Tables<"change_sets"> => ({
  applied_at: null,
  author_id: null,
  created_at: "2026-10-15T12:00:00Z",
  event_id: "event",
  id: "id",
  model_version: null,
  prompt_version: null,
  proposed_by: "ai",
  status: "applied",
  summary: "Alpha moves its database to MySQL",
  tokens_in: null,
  tokens_out: null,
  ...overrides,
});

describe("changeKind", () => {
  it("reads the kind from generated summaries", () => {
    expect(changeKind('Rewrote 1 line of "Facts"')).toBe("page_rewrite");
    expect(changeKind('Rewrote 5 lines of "Facts"')).toBe("page_rewrite");
    expect(changeKind("Updated article knowledge selections and introduction")).toBe("article");
    expect(changeKind("Linked existing claims (3 links proposed)")).toBe("links");
    expect(changeKind("Cleaning cycle: 2 duplicate groups to merge")).toBe("duplicates");
    expect(changeKind("Archived source: WHMIS")).toBe("sources");
    expect(changeKind("Restored source: WHMIS")).toBe("sources");
    expect(changeKind("Approver rejected search: WHMIS")).toBe("approvals");
    expect(changeKind("Reversed approver decision: WHMIS")).toBe("approvals");
    expect(changeKind("Alpha moves its database to MySQL")).toBe("knowledge");
  });
});

describe("filterChanges", () => {
  const rows = [
    changeSet({ id: "a", summary: 'Rewrote 1 line of "Facts"' }),
    changeSet({ id: "b", proposed_by: "person", status: "reverted" }),
    changeSet({ id: "c", created_at: "2026-09-01T12:00:00Z" }),
  ];
  const now = new Date("2026-10-15T18:00:00");
  const ids = (search: string) => filterChanges(rows, readChangeFilters(new URLSearchParams(search)), now).map((row) => row.id);

  it("keeps everything with no filters", () => {
    expect(ids("")).toEqual(["a", "b", "c"]);
  });

  it("narrows by status, proposer, kind and time", () => {
    expect(ids("status=reverted")).toEqual(["b"]);
    expect(ids("by=ai")).toEqual(["a", "c"]);
    expect(ids("kind=page_rewrite")).toEqual(["a"]);
    expect(ids("when=month")).toEqual(["a", "b"]);
  });
});

describe("matchesProposer", () => {
  const byPerson = changeSet({ proposed_by: "person", author_id: "sam" });
  const byModel = changeSet({ proposed_by: "ai", model_version: "zai-org/GLM-5.3-Flash" });

  it("keeps one person's changes", () => {
    expect(matchesProposer(byPerson, "person:sam")).toBe(true);
    expect(matchesProposer(byPerson, "person:alex")).toBe(false);
    expect(matchesProposer(byModel, "person:sam")).toBe(false);
  });

  it("keeps one model's changes", () => {
    expect(matchesProposer(byModel, "model:zai-org/GLM-5.3-Flash")).toBe(true);
    expect(matchesProposer(byModel, "model:other")).toBe(false);
  });

  it("still filters by kind, and keeps everything with no filter", () => {
    expect(matchesProposer(byModel, "ai")).toBe(true);
    expect(matchesProposer(byPerson, "ai")).toBe(false);
    expect(matchesProposer(byPerson, "")).toBe(true);
  });
});
