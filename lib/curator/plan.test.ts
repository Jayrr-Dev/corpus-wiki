import { describe, expect, it } from "vitest";
import { applyChanges, checkAnswer, checkDispatches, type CuratorAnswer } from "./plan";
import { findCandidates, missingClaims, titleOverlap, titleProblems, treeHealth, type CuratorPage } from "./score";

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
  it("files each claim no page cites under the closest page, never an organization page", () => {
    const vectors = new Map<string, number[]>([["1", [1, 0, 0]], ["2", [0, 1, 0]], ["3", [0, 0, 1]], ["u1", [0.9, 0.1, 0]], ["u2", [0.1, 0.9, 0]], ["u3", [0, 0.1, 0.9]], ["u4", [-1, -1, -1]]]);
    const pages = [page("permits", ["1"]), page("fees", ["2"]), page("org", ["3"], { organization: true })];
    const found = missingClaims(pages, [{ id: "u1", title: "Permit term" }, { id: "u2", title: "Fee amount" }, { id: "u3", title: "Founded" }, { id: "u4", title: "Unrelated" }, { id: "u5", title: "No vector" }, { id: "u6", title: "Turned down", turnedDown: true }], vectors.set("u6", [-1, 0, -1]));
    expect(found.map((c) => `${c.kind}:${c.pageIds[0] ?? ""}:${c.claimIds!.join(",")}`)).toEqual(["missing_claims:permits:u1", "missing_claims:fees:u2", "uncovered::u3,u4"]);
    expect(found[0]!.detail).toContain("“Permit term”");
  });
  it("flags titles that break the naming rules or no longer match the page, never an organization's", () => {
    const claims = new Map([["1", "Permit fee amount"], ["2", "Permit term"], ["3", "Renewal deadline"], ["4", "Gas line clearance"], ["5", "Water line clearance"], ["6", "Pole clearance"]]);
    const pages = [
      page("org", ["1"], { title: "ATCO", organization: true }),
      page("whmis", ["1", "2", "3"], { title: "WHMIS", parentId: "org" }),
      page("amp", ["1", "2", "3"], { title: "Fees & terms" }),
      page("caps", ["1", "2", "3"], { title: "Permit Fees And Renewal Deadlines" }),
      page("parent", ["1", "2", "3"], { title: "ATCO permit fees", parentId: "org" }),
      page("drift", ["4", "5", "6"], { title: "Permit renewals", sections: ["Overview"] }),
      page("fine", ["4", "5", "6"], { title: "Minimum clearances between utilities", sections: ["Overview"] }),
      page("spelled", ["1", "2", "3"], { title: "Workplace Hazardous Materials Information System (WHMIS) permits" }),
    ];
    const flagged = titleProblems(pages, claims).map((c) => c.pageIds[0]);
    expect(flagged).toEqual(["whmis", "amp", "caps", "parent", "drift"]);
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

  it("hands the Planner the claims no page cites that fit its page", () => {
    const candidates = [{ kind: "missing_claims" as const, pageIds: ["crossings"], detail: "", claimIds: ["u1", "u2"] }];
    const d = (role: "reviewer" | "planner", p: string) => ({ role, page: p, heading: null, note: "n", reason: "r" });
    const { dispatches } = checkDispatches({ summary: "", proposals: [], dispatches: [d("planner", "P3"), d("reviewer", "P3"), d("planner", "P2")] }, pages, [], candidates);
    expect(dispatches.map((x) => `${x.role}:${x.pageId}:${x.claimIds.join(",")}`)).toEqual(["planner:crossings:u1,u2", "reviewer:crossings:", "planner:clearances:"]);
  });

  it("sends the Article Proposer the claims that fit no page, once, and only when there are some", () => {
    const proposer = { role: "proposer" as const, page: null, heading: null, note: "Factory inspection", reason: "r" };
    const none = checkDispatches({ summary: "", proposals: [], dispatches: [proposer] }, pages, [], []);
    expect(none.dispatches).toEqual([]);
    const candidates = [{ kind: "uncovered" as const, pageIds: [], detail: "", claimIds: ["u7", "u8", "u9"] }];
    const { dispatches, skipped } = checkDispatches({ summary: "", proposals: [], dispatches: [proposer, proposer] }, pages, [], candidates);
    expect(dispatches).toEqual([{ role: "proposer", pageId: null, heading: null, note: "Factory inspection", reason: "r", claimIds: ["u7", "u8", "u9"] }]);
    expect(skipped).toEqual(["proposer: over the limit or repeated"]);
  });
});
