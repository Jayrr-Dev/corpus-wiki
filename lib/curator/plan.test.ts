import { describe, expect, it } from "vitest";
import { applyChanges, checkAnswer, checkDispatches, type CuratorAnswer } from "./plan";
import { findCandidates, titleOverlap, treeHealth, type CuratorPage } from "./score";

const page = (id: string, claimIds: string[], extra: Partial<CuratorPage> = {}): CuratorPage =>
  ({ id, title: id, parentId: null, articleType: null, scope: null, contextName: null, organization: false, claimIds, lines: claimIds.length, sections: ["Overview"], ...extra });
const proposal = (p: Partial<CuratorAnswer["proposals"][number]>) =>
  ({ operation: "merge", page: "P1", pages: null, into: null, parent: null, title: null, sectionTitle: null, articleType: null, scope: null, confident: true, reason: "r", ...p }) as CuratorAnswer["proposals"][number];
const none = new Map<string, number[]>();

describe("Curator scoring", () => {
  it("flags identical pages as duplicates and a page inside another as contained", () => {
    const pages = [page("a", ["1", "2", "3"]), page("b", ["1", "2", "3"]), page("c", ["1", "2", "4", "5"]), page("d", ["9", "8", "7"])];
    const kinds = findCandidates(pages, none).map((c) => `${c.kind}:${c.pageIds.join(",")}`);
    expect(kinds).toContain("duplicate:a,b");
    expect(treeHealth(pages, none).duplicatePairs).toBe(1);
  });
  it("does not flag an organization page for repeating a page under it", () => {
    const pages = [page("org", ["1", "2", "3", "4"], { organization: true }), page("program", ["1", "2", "3", "4"], { parentId: "org" }), page("stub", ["9"], { organization: true })];
    expect(findCandidates(pages, none).filter((c) => c.kind !== "untyped")).toEqual([]);
    expect(treeHealth(pages, none)).toMatchObject({ duplicatePairs: 0, organizationOverlaps: 1, stubs: 0 });
  });
  it("treats an acronym in brackets as the same title", () => {
    expect(titleOverlap("Utility Line Assignment (ULA) application process", "Utility Line Assignment application process")).toBe(1);
  });
});

describe("Curator plan", () => {
  const pages = [page("org", ["1"]), page("hs", ["2", "3"], { parentId: "org" }), page("program", ["2", "3", "4"], { parentId: "hs" }), page("ppe", ["2"], { parentId: "hs" })];

  it("keeps every claim and every child when a page merges into its own child", () => {
    const { changes } = checkAnswer({ summary: "", dispatches: [], proposals: [proposal({ page: "P2", into: "P3" })] }, pages);
    expect(changes).toMatchObject([{ operation: "merge", pageId: "hs", intoPageId: "program", unitIds: [] }]);
    const after = applyChanges(pages, changes);
    expect(after.find((p) => p.id === "program")!.parentId).toBe("org");
    expect(after.find((p) => p.id === "ppe")!.parentId).toBe("program");
    expect(new Set(after.flatMap((p) => p.claimIds))).toEqual(new Set(["1", "2", "3", "4"]));
  });

  it("never merges away or renames an organization page", () => {
    const orgPages = [page("org", ["1"], { organization: true }), page("program", ["1"], { parentId: "org" })];
    const { changes, skipped } = checkAnswer({ summary: "", dispatches: [], proposals: [proposal({ page: "P1", into: "P2" }), proposal({ operation: "rename", page: "P1", title: "Program" }), proposal({ page: "P2", into: "P1" })] }, orgPages);
    expect(skipped.map((s) => s.why)).toEqual(["organization pages stay as parents", "organization pages keep the organization's name"]);
    expect(changes).toMatchObject([{ operation: "merge", pageId: "program", intoPageId: "org" }]);
  });

  it("skips merges across organizations, reused pages and moves that loop", () => {
    const orgs = [page("a", ["1"], { contextName: "EPCOR" }), page("b", ["1"], { contextName: "City of Edmonton" }), page("c", ["2"], { parentId: "a" })];
    const { changes, skipped } = checkAnswer({ summary: "", dispatches: [], proposals: [
      proposal({ page: "P1", into: "P2" }),
      proposal({ operation: "move", page: "P1", parent: "P3" }),
      proposal({ operation: "move", page: "P3", parent: null }),
      proposal({ operation: "merge", page: "P3", into: "P1" }),
      proposal({ operation: "rename", page: "P9", title: "x" }),
    ] }, orgs);
    expect(changes.map((c) => c.operation)).toEqual(["move"]);
    expect(skipped.map((s) => s.why)).toEqual([
      "pages belong to different organizations (EPCOR, City of Edmonton)",
      "would put the page under itself",
      "page already merged or moved in this run",
      "unknown or already merged page",
    ]);
  });
});

describe("Curator placeholder pages and dispatch", () => {
  const pages = [page("org", ["1"], { organization: true }), page("clearances", ["2", "3", "4"]), page("crossings", ["5", "6", "7"]), page("ula", ["8", "9", "10"], { parentId: "org" })];

  it("files pages under a new page, and never files an organization page or reuses a title", () => {
    const { changes, skipped } = checkAnswer({ summary: "", dispatches: [], proposals: [
      proposal({ operation: "group", page: "P2", pages: ["P3"], title: "Utility separation standards", articleType: "requirement", parent: "P4" }),
      proposal({ operation: "group", page: "P1", pages: [], title: "Organizations", articleType: "concept" }),
      proposal({ operation: "group", page: "P4", pages: [], title: "clearances", articleType: "concept" }),
    ] }, pages);
    expect(changes).toMatchObject([{ operation: "group", pageIds: ["clearances", "crossings"], parentPageId: "ula" }]);
    expect(skipped.map((s) => s.why)).toEqual(["organization pages stay at the top", "a page already has that title"]);
    const after = applyChanges(pages, changes);
    expect(after.find((p) => p.id === "new:Utility separation standards")).toMatchObject({ parentId: "ula", claimIds: [] });
    expect(after.find((p) => p.id === "crossings")!.parentId).toBe("new:Utility separation standards");
  });

  it("keeps dispatches to known pages, needs a heading for research, and caps them", () => {
    const { changes } = checkAnswer({ summary: "", dispatches: [], proposals: [proposal({ page: "P3", into: "P2" })] }, pages);
    const d = (role: "reviewer" | "planner" | "researcher", p: string, heading: string | null = null) => ({ role, page: p, heading, note: "n", reason: "r" });
    const { dispatches, skipped } = checkDispatches({ summary: "", proposals: [], dispatches: [d("reviewer", "P2"), d("planner", "P3"), d("researcher", "P4"), d("researcher", "P4", "Permit fees"), d("reviewer", "P2")] }, pages, changes);
    expect(dispatches.map((x) => `${x.role}:${x.pageId}`)).toEqual(["reviewer:clearances", "researcher:ula"]);
    expect(skipped).toHaveLength(3);
  });
});
