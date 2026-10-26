import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeContext } from "@/lib/knowledge/context";
import type { DbRpc } from "@/lib/db/rpc";
import { retrieve } from "./retrieve";

const mocks = vi.hoisted(() => ({ getServerSupabase: vi.fn(), similarUnits: vi.fn(), similarGlossary: vi.fn(), similarPassages: vi.fn(async (): Promise<unknown[]> => []), savedVectors: vi.fn(), scopeIds: vi.fn(), searchText: vi.fn(), linked: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: mocks.getServerSupabase }));
vi.mock("@/lib/knowledge/embeddingStore", () => ({ similarUnits: mocks.similarUnits, savedVectors: mocks.savedVectors, similarPassages: mocks.similarPassages }));
vi.mock("@/lib/glossary/embeddingStore", () => ({ similarGlossary: mocks.similarGlossary }));

const entity = { id: "e-utilitek", type: "company", key: "utilitek", name: "Utilitek" };
const scoped = (key: string): KnowledgeContext => ({
  entities: [{ type: "company", key, role: "subject" }],
  applicability: { status: "scoped", entities: [{ type: "company", key }], conditions: null },
});
const revision = (id: string, context: KnowledgeContext | null) => ({
  id: `r-${id}`, unit_id: id, title: id, content: `Orientation rule for ${id}`, passage_ids: [`p-${id}`], knowledge_context: context,
});
const revisions = [
  revision("utilitek", scoped("utilitek")),
  revision("other", scoped("other")),
  revision("general", { entities: [], applicability: { status: "general", entities: [], conditions: null } }),
  revision("unknown", null),
];

type Row = Record<string, unknown>;
type Query = { table: string; columns: string; filters: { op: string; key: string; value: unknown }[] };
function mockClient(rows: Row[] = revisions, relationships: Row[] = [], extraSources: Row[] = []) {
  const queries: Query[] = [];
  const tableRows: Record<string, Row[]> = {
    relationships,
    entities: [entity],
    units: rows.map(row => ({ id: row.unit_id, current_revision_id: row.id, retired_at: null })),
    revisions: rows,
    passages: rows.map(row => ({ id: (row.passage_ids as string[])[0], source_id: `source-${row.unit_id}`, text: `Source evidence for ${row.unit_id}` })),
    sources: [...rows.map(row => ({ id: `source-${row.unit_id}`, title: `Source ${row.unit_id}`, archived_at: null, replaced_by_id: null })), ...extraSources],
    section_lines: [
      { page_id: "own", content: "Eligible article", unit_revision_ids: ["r-utilitek"], is_stale: false },
      { page_id: "mixed", content: "Mixed company policies", unit_revision_ids: ["r-utilitek", "r-other"], is_stale: false },
      { page_id: "stale", content: "Old policy text", unit_revision_ids: ["r-utilitek"], is_stale: true },
      { page_id: "other", content: "Other company article", unit_revision_ids: ["r-other"], is_stale: false },
    ],
    pages: ["own", "mixed", "stale", "other"].map(id => ({ id, title: id, slug: id, retired_at: null })),
  };
  const client = { from(table: string) {
    const query: Query = { table, columns: "", filters: [] };
    queries.push(query);
    let single = false;
    let limit = Infinity;
    const builder = {
      select(columns: string) { query.columns = columns; return builder; },
      eq(key: string, value: unknown) { query.filters.push({ op: "eq", key, value }); return builder; },
      is(key: string, value: unknown) { query.filters.push({ op: "is", key, value }); return builder; },
      in(key: string, value: unknown[]) { query.filters.push({ op: "in", key, value }); return builder; },
      overlaps(key: string, value: unknown[]) { query.filters.push({ op: "overlaps", key, value }); return builder; },
      or(value: string) { query.filters.push({ op: "or", key: "", value }); return builder; },
      limit(value: number) { limit = value; return builder; },
      single() { single = true; return builder; },
      then(resolve: (value: unknown) => unknown) {
        const data = (tableRows[table] ?? []).filter(row => query.filters.every(filter => {
          if (filter.op === "in") return (filter.value as unknown[]).includes(row[filter.key]);
          if (filter.op === "overlaps") return (row[filter.key] as unknown[]).some(value => (filter.value as unknown[]).includes(value));
          if (filter.op === "eq") return row[filter.key] === filter.value;
          if (filter.op === "is") return (row[filter.key] ?? null) === filter.value;
          return true;
        })).slice(0, limit);
        return Promise.resolve(resolve({ data: single ? data[0] : data, error: null }));
      },
    };
    return builder;
  } };
  mocks.getServerSupabase.mockResolvedValue(client);
  return queries;
}
const db: DbRpc = { async call<T>(name: string): Promise<T> {
  if (name === "living_page_query_units") return await mocks.scopeIds() as T;
  if (name === "search_units_text") return await mocks.searchText() as T;
  if (name === "linked_units") return await mocks.linked() as T;
  throw new Error(`Unexpected database RPC ${name}`);
} };
const embedder = { model: "test", embed: vi.fn(async () => [[1, 0]]) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mocks.searchText.mockResolvedValue([]);
  mocks.linked.mockResolvedValue([]);
  embedder.embed.mockResolvedValue([[1, 0]]);
  mocks.scopeIds.mockResolvedValue(["utilitek"]);
  mocks.similarGlossary.mockResolvedValue([]);
  mocks.savedVectors.mockResolvedValue(new Map([["r-utilitek", [1, 0]]]));
  mocks.similarUnits.mockResolvedValue(revisions.map(row => ({ unitId: row.unit_id, revisionId: row.id, content: "vector text must not be exposed", similarity: 0.9 })));
});

describe("retrieve scoped knowledge", () => {
  it.each(["legacy", "hybrid"])("filters other-company and missing contexts, labels general knowledge, and blocks mixed or stale articles (%s)", async (mode) => {
    vi.stubEnv("CHAT_SEARCH", mode);
    // Hybrid's global arms also bring the other company's claim; the context recheck still drops it
    mocks.searchText.mockResolvedValue([{ unit_id: "other", revision_id: "r-other", rank: 1 }]);
    mocks.linked.mockResolvedValue([{ unit_id: "unknown", via_unit_id: "other", type: "supports" }]);
    const queries = mockClient();
    const result = await retrieve("orientation", db, embedder, entity.id);
    const hrefs = result.references.map(reference => reference.href);
    expect(hrefs).toContain("/units/utilitek");
    expect(hrefs).toContain("/units/general");
    expect(hrefs).toContain("/p/own");
    expect(hrefs).not.toContain("/units/other");
    expect(hrefs).not.toContain("/units/unknown");
    expect(result.references.some(reference => reference.kind === "Source")).toBe(false);
    expect(queries.some(query => query.table === "passages")).toBe(false);
    expect(hrefs).not.toContain("/p/mixed");
    expect(hrefs).not.toContain("/p/stale");
    expect(hrefs).not.toContain("/p/other");
    expect(result.references.find(reference => reference.href === "/units/general")?.text).toContain("General knowledge");
    expect(JSON.stringify(result.references)).not.toContain("vector text must not be exposed");
    expect(queries.filter(query => ["section_lines", "passages"].includes(query.table) && query.filters.some(filter => filter.op === "or"))).toEqual([]);
  });

  it("does not fall back to unscoped source or article matches when all candidate units are excluded", async () => {
    const queries = mockClient([revisions[1]!]);
    const result = await retrieve("orientation", db, embedder, entity.id);
    expect(result.references).toEqual([]);
    expect(queries.some(query => query.table === "passages")).toBe(false);
    expect(queries.some(query => query.table === "pages")).toBe(false);
  });

  it("retains broad article and source search when no entity was selected", async () => {
    const queries = mockClient();
    const result = await retrieve("orientation", db, embedder);
    expect(result.references.some(reference => reference.kind === "Source")).toBe(true);
    expect(queries.some(query => query.table === "passages" && query.filters.some(filter => filter.op === "or"))).toBe(true);
    expect(queries.some(query => query.table === "section_lines" && query.filters.some(filter => filter.op === "or"))).toBe(true);
  });

  it("finds source text by meaning when no claim matches, but never for a scoped question", async () => {
    mockClient([], [], [{ id: "source-x", title: "Source x", archived_at: null, replaced_by_id: null }]);
    mocks.similarUnits.mockResolvedValue([]);
    mocks.similarPassages.mockResolvedValueOnce([{ passageId: "p-x", sourceId: "source-x", text: "Lockout steps", similarity: 0.7 }]);
    const result = await retrieve("lockout", db, embedder);
    expect(result.references.find(reference => reference.href === "/sources/source-x")?.text).toBe("Lockout steps");

    mockClient();
    await retrieve("orientation", db, embedder, entity.id);
    expect(mocks.similarPassages).toHaveBeenCalledTimes(1);
  });

  it("retrieves glossary meanings through current source claims, excluding other companies and stale revisions", async () => {
    mockClient();
    const meaning = (id: string, revisionId = `r-${id}`) => ({ entry: {
      term: `Term ${id}`, expansion: null, aliases: [], category: "technical term", definition: `Dictionary meaning for ${id}`,
      context: id, scopeKey: id, citations: [{ unitId: id, revisionId, sourceId: `source-${id}`, sourceTitle: `Source ${id}` }],
    }, similarity: 0.9 });
    mocks.similarGlossary.mockResolvedValue([meaning("utilitek"), meaning("other"), meaning("general"), meaning("unknown"), meaning("utilitek", "superseded")]);
    const result = await retrieve("explain terminology", db, embedder, entity.id);
    const definitions = result.references.filter((reference) => reference.kind === "Glossary");
    expect(definitions.map((reference) => reference.title)).toEqual(["Term utilitek", "Term general"]);
    expect(definitions[0]?.href).toContain("/glossary#term-");
    expect(definitions[0]?.text).toContain("AI-generated dictionary meaning");
  });

  it.each([[true, "legacy"], [false, "legacy"], [true, "hybrid"], [false, "hybrid"]])("searches within the entity before global limits (semantic search: %s, %s)", async (semantic, mode) => {
    vi.stubEnv("CHAT_SEARCH", mode);
    const others = Array.from({ length: 40 }, (_, index) => revision(`other-${index}`, scoped("other")));
    const own = revision("utilitek", scoped("utilitek"));
    const queries = mockClient([...others, own]);
    mocks.similarUnits.mockResolvedValue(others.slice(0, 12).map(row => ({ unitId: row.unit_id, revisionId: row.id, content: row.content, similarity: 0.99 })));
    if (!semantic) embedder.embed.mockRejectedValueOnce(new Error("offline"));
    const result = await retrieve("orientation", db, embedder, entity.id);
    expect(result.references.some(reference => reference.href === "/units/utilitek")).toBe(true);
    expect(result.references.some(reference => reference.href.startsWith("/units/other"))).toBe(false);
    expect(queries.some(query => query.table === "revisions" && query.filters.some(filter => filter.op === "in" && (filter.value as string[]).includes("r-utilitek")) && query.filters.some(filter => filter.op === "or"))).toBe(true);
    if (semantic) expect(mocks.savedVectors).toHaveBeenCalledWith(db, "test", ["r-utilitek"]);
    else expect(mocks.savedVectors).not.toHaveBeenCalled();
  });

  it("enforces entity context during lexical-only fallback", async () => {
    mockClient();
    embedder.embed.mockRejectedValueOnce(new Error("offline"));
    const result = await retrieve("orientation", db, embedder, entity.id);
    expect(result.warning).toContain("text matches only");
    expect(result.references.some(reference => reference.href === "/units/utilitek")).toBe(true);
    expect(result.references.some(reference => reference.href === "/units/other")).toBe(false);
  });
});

describe("composites in answers", () => {
  it("gives a matched step's procedure with every step in order", async () => {
    const context = scoped("utilitek");
    const procedure = { ...revision("lockout", context), content: "Utilitek locks out a machine in two steps", structure: { type: "sequence", complete: true, mode: null } };
    const first = { ...revision("isolate", context), content: "Utilitek isolates the energy" };
    const second = { ...revision("lock", context), content: "Utilitek applies a lock" };
    mockClient([procedure, first, second], [
      { from_unit_id: "lock", to_unit_id: "lockout", type: "part_of", retired_at: null, position: 2, created_at: "2026-11-09T00:00:00Z" },
      { from_unit_id: "isolate", to_unit_id: "lockout", type: "part_of", retired_at: null, position: 1, created_at: "2026-11-09T00:00:01Z" },
    ]);
    mocks.scopeIds.mockResolvedValue(["lock"]);
    mocks.similarUnits.mockResolvedValue([{ unitId: "lock", revisionId: "r-lock", content: "", similarity: 0.9 }]);
    mocks.savedVectors.mockResolvedValue(new Map([["r-lock", [1, 0]]]));
    const result = await retrieve("lock", db, embedder, entity.id);
    const steps = result.references.find(reference => reference.href === "/units/lockout");
    expect(steps?.text).toContain(["Steps, in order:", "1. Utilitek isolates the energy", "2. Utilitek applies a lock"].join("\n"));
  });
});
