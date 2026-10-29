import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database/types";
import type { GlossaryEntry } from "@/lib/glossary/entries";

vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabase: () => { throw new Error("tests pass their own client"); } }));

const { glossaryTermsByUnit, isCompleteScope, loadScopeClaims, namesEntity, pickCoverage, rankScopeClaims, topicDomainIds } = await import("./scope");

type Row = Record<string, unknown>;

// jsonb @>: every key and array element on the right is found on the left
function containsJson(left: unknown, right: unknown): boolean {
  if (Array.isArray(right)) return Array.isArray(left) && right.every((item) => left.some((candidate) => containsJson(candidate, item)));
  if (right && typeof right === "object") return !!left && typeof left === "object" && Object.entries(right).every(([key, value]) => containsJson((left as Row)[key], value));
  return left === right;
}

// IN-MEMORY SUPABASE: just the query builder calls loadScopeClaims makes, over plain rows
function fakeClient(tables: Record<string, Row[]>, glossary: unknown = null) {
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const builder = {
      select: () => builder,
      order: () => builder,
      eq: (column: string, value: unknown) => { rows = rows.filter((row) => row[column] === value); return builder; },
      in: (column: string, values: unknown[]) => { rows = rows.filter((row) => values.includes(row[column])); return builder; },
      is: (column: string, value: null) => { rows = rows.filter((row) => (row[column] ?? null) === value); return builder; },
      not: (column: string, _op: "is", value: null) => { rows = rows.filter((row) => (row[column] ?? null) !== value); return builder; },
      contains: (column: string, value: unknown) => { rows = rows.filter((row) => containsJson(row[column], value)); return builder; },
      then: (resolve: (result: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    return builder;
  };
  const rpc = async (name: string) => (name === "read_glossary_view" ? { data: glossary, error: null } : { data: null, error: { message: `no ${name}` } });
  return { from, rpc } as unknown as SupabaseClient<Database>;
}

const context = (entities: { type: string; key: string; role?: string }[], scoped: { type: string; key: string }[] = []) => ({
  entities: entities.map((entity) => ({ role: "subject", ...entity })),
  applicability: scoped.length ? { status: "scoped", entities: scoped, conditions: null } : { status: "general", entities: [], conditions: null },
});

// A small wiki: Utilities › Water › Pipes, two articles and an entity
const WIKI: Record<string, Row[]> = {
  domains: [
    { id: "d-util", path: "Utilities", retired_at: null },
    { id: "d-water", path: "Utilities/Water", retired_at: null },
    { id: "d-pipes", path: "Utilities/Water/Pipes", retired_at: null },
    { id: "d-waterfall", path: "Utilities/Waterfall", retired_at: null },
    { id: "d-old", path: "Utilities/Water/Old", retired_at: "2026-01-01" },
  ],
  unit_domains: [
    { unit_id: "u1", domain_id: "d-water" },
    { unit_id: "u2", domain_id: "d-pipes" },
    { unit_id: "u3", domain_id: "d-waterfall" },
    { unit_id: "u4", domain_id: "d-water" },
    { unit_id: "u5", domain_id: "d-old" },
  ],
  units: [
    { id: "u1", current_revision_id: "r1b", retired_at: null },
    { id: "u2", current_revision_id: "r2", retired_at: null },
    { id: "u3", current_revision_id: "r3", retired_at: null },
    { id: "u4", current_revision_id: "r4", retired_at: "2026-02-01" },
    { id: "u5", current_revision_id: "r5", retired_at: null },
  ],
  revisions: [
    { id: "r1a", unit_id: "u1", title: "Old", content: "Pipes were iron.", created_at: "2026-01-01", knowledge_context: context([{ type: "org", key: "acme" }]) },
    { id: "r1b", unit_id: "u1", title: "Pipes", content: "Pipes are copper.", created_at: "2026-03-01", knowledge_context: context([]) },
    { id: "r2", unit_id: "u2", title: "Depth", content: "Pipes sit 1 m deep.", created_at: "2026-02-01", knowledge_context: context([{ type: "org", key: "acme" }]) },
    { id: "r3", unit_id: "u3", title: "Falls", content: "Falls are tall.", created_at: "2026-02-01", knowledge_context: context([], [{ type: "org", key: "acme" }]) },
    { id: "r4", unit_id: "u4", title: "Gone", content: "Retired.", created_at: "2026-02-01", knowledge_context: context([]) },
    { id: "r5", unit_id: "u5", title: "Old topic", content: "Retired topic.", created_at: "2026-02-01", knowledge_context: context([]) },
  ],
  sections: [
    { id: "s1", page_id: "p1", retired_at: null },
    { id: "s2", page_id: "p1", retired_at: null },
    { id: "s3", page_id: "p2", retired_at: null },
    { id: "s4", page_id: "p1", retired_at: "2026-02-01" },
  ],
  section_inputs: [
    { section_id: "s1", unit_id: "u2", revision_id: "r2" },
    { section_id: "s2", unit_id: "u2", revision_id: "r2" },
    { section_id: "s3", unit_id: "u1", revision_id: "r1b" },
    { section_id: "s4", unit_id: "u3", revision_id: "r3" },
  ],
  entities: [{ id: "e-acme", type: "org", key: "acme", name: "Acme", retired_at: null, merged_into_id: null }],
};

describe("topicDomainIds", () => {
  it("takes the topic and its children by path, not topics that only share a prefix", () => {
    expect(topicDomainIds(WIKI.domains as { id: string; path: string }[], "d-water").sort()).toEqual(["d-old", "d-pipes", "d-water"]);
    expect(topicDomainIds([], "d-water")).toEqual([]);
  });
});

describe("namesEntity", () => {
  it("matches the claim's parties and where it applies", () => {
    const acme = { type: "org", key: "acme" };
    expect(namesEntity(context([{ ...acme, role: "mentioned" }]) as never, acme)).toBe(true);
    expect(namesEntity(context([], [acme]) as never, acme)).toBe(true);
    expect(namesEntity(context([{ type: "org", key: "other" }]) as never, acme)).toBe(false);
    expect(namesEntity(null, acme)).toBe(false);
  });
});

describe("ranking and coverage", () => {
  const claims = [
    { unitId: "a", citedBy: 0, createdAt: "2026-03-01" },
    { unitId: "b", citedBy: 3, createdAt: "2026-01-01" },
    { unitId: "c", citedBy: 1, createdAt: "2026-01-01" },
    { unitId: "d", citedBy: 1, createdAt: "2026-02-01" },
  ];

  it("puts the most-cited claims first, then the newest", () => {
    expect(rankScopeClaims(claims).map((claim) => claim.unitId)).toEqual(["b", "d", "c", "a"]);
  });

  it("keeps 25, 50 or 100 percent, rounding up", () => {
    const ranked = rankScopeClaims(claims);
    expect(pickCoverage(ranked, 25).map((claim) => claim.unitId)).toEqual(["b"]);
    expect(pickCoverage(ranked, 50).map((claim) => claim.unitId)).toEqual(["b", "d"]);
    expect(pickCoverage(ranked, 100)).toHaveLength(4);
    expect(pickCoverage(ranked.slice(0, 1), 25)).toHaveLength(1);
    expect(pickCoverage([], 50)).toEqual([]);
  });
});

describe("loadScopeClaims", () => {
  const client = fakeClient(WIKI);

  it("pulls a topic's live claims and its child topics', as current revisions, most cited first", async () => {
    const claims = await loadScopeClaims({ kind: "topic", id: "d-water" }, client);
    expect(claims.map((claim) => [claim.unitId, claim.revisionId, claim.citedBy])).toEqual([["u2", "r2", 2], ["u1", "r1b", 1]]);
    expect(claims[1]).toMatchObject({ title: "Pipes", content: "Pipes are copper.", createdAt: "2026-03-01" });
  });

  it("pulls the claims an article's live sections cite", async () => {
    expect((await loadScopeClaims({ kind: "article", id: "p1" }, client)).map((claim) => claim.unitId)).toEqual(["u2"]);
    expect(await loadScopeClaims({ kind: "article", id: "missing" }, client)).toEqual([]);
  });

  it("pulls the claims whose current context names the entity", async () => {
    const claims = await loadScopeClaims({ kind: "entity", id: "e-acme" }, client);
    // u1 named Acme only in an older revision
    expect(claims.map((claim) => claim.unitId)).toEqual(["u2", "u3"]);
    expect(await loadScopeClaims({ kind: "entity", id: "missing" }, client)).toEqual([]);
  });

  it("pulls the glossary's cited claims with their terms", async () => {
    const entry = (term: string, unitId: string): GlossaryEntry => ({
      term, expansion: null, aliases: [], category: "term" as GlossaryEntry["category"], definition: `${term} means it.`, context: null, scopeKey: "general",
      citations: [{ unitId, revisionId: "x", sourceId: "s", sourceTitle: "Source" }],
    });
    const glossary = { entries: [entry("Pipe", "u1"), entry("Duct", "u1"), entry("Retired", "u4")], live_entries: [], status: "ready" };
    const claims = await loadScopeClaims({ kind: "glossary" }, fakeClient(WIKI, glossary));
    expect(claims.map((claim) => claim.unitId)).toEqual(["u1"]);
    expect(claims[0]!.terms).toEqual([{ term: "Pipe", definition: "Pipe means it." }, { term: "Duct", definition: "Duct means it." }]);
    expect(glossaryTermsByUnit([]).size).toBe(0);
  });
});

describe("isCompleteScope", () => {
  it("needs an id except for the glossary", () => {
    expect(isCompleteScope({ kind: "glossary" })).toBe(true);
    expect(isCompleteScope({ kind: "topic", id: "d1" })).toBe(true);
    expect(isCompleteScope({ kind: "topic", id: "" })).toBe(false);
    expect(isCompleteScope(null)).toBe(false);
  });
});
