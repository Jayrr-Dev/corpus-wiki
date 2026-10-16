import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeContext } from "@/lib/knowledge/context";
import type { DbRpc } from "@/lib/db/rpc";
import { retrieve } from "./retrieve";

const mocks = vi.hoisted(() => ({ getServerSupabase: vi.fn(), similarUnits: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: mocks.getServerSupabase }));
vi.mock("@/lib/knowledge/embeddingStore", () => ({ similarUnits: mocks.similarUnits }));

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
function mockClient(rows = revisions) {
  const queries: Query[] = [];
  const tableRows: Record<string, Row[]> = {
    entities: [entity],
    units: rows.map(row => ({ id: row.unit_id, current_revision_id: row.id, retired_at: null })),
    revisions: rows,
    passages: rows.map(row => ({ id: row.passage_ids[0], source_id: `source-${row.unit_id}`, text: `Source evidence for ${row.unit_id}` })),
    sources: rows.map(row => ({ id: `source-${row.unit_id}`, title: `Source ${row.unit_id}`, archived_at: null, replaced_by_id: null })),
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
    const builder = {
      select(columns: string) { query.columns = columns; return builder; },
      eq(key: string, value: unknown) { query.filters.push({ op: "eq", key, value }); return builder; },
      is(key: string, value: unknown) { query.filters.push({ op: "is", key, value }); return builder; },
      in(key: string, value: unknown[]) { query.filters.push({ op: "in", key, value }); return builder; },
      overlaps(key: string, value: unknown[]) { query.filters.push({ op: "overlaps", key, value }); return builder; },
      or(value: string) { query.filters.push({ op: "or", key: "", value }); return builder; },
      limit() { return builder; },
      single() { single = true; return builder; },
      then(resolve: (value: unknown) => unknown) {
        const data = (tableRows[table] ?? []).filter(row => query.filters.every(filter => {
          if (filter.op === "in") return (filter.value as unknown[]).includes(row[filter.key]);
          if (filter.op === "overlaps") return (row[filter.key] as unknown[]).some(value => (filter.value as unknown[]).includes(value));
          if (filter.op === "eq") return row[filter.key] === filter.value;
          if (filter.op === "is") return (row[filter.key] ?? null) === filter.value;
          return true;
        }));
        return Promise.resolve(resolve({ data: single ? data[0] : data, error: null }));
      },
    };
    return builder;
  } };
  mocks.getServerSupabase.mockResolvedValue(client);
  return queries;
}
const db: DbRpc = { call: async () => { throw new Error("Unexpected database RPC"); } };
const embedder = { model: "test", embed: vi.fn(async () => [[1, 0]]) };

beforeEach(() => {
  vi.clearAllMocks();
  embedder.embed.mockResolvedValue([[1, 0]]);
  mocks.similarUnits.mockResolvedValue(revisions.map(row => ({ unitId: row.unit_id, revisionId: row.id, content: "vector text must not be exposed", similarity: 0.9 })));
});

describe("retrieve scoped knowledge", () => {
  it("filters other-company and missing contexts, labels general knowledge, and blocks mixed or stale articles", async () => {
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

  it("enforces entity context during lexical-only fallback", async () => {
    mockClient();
    embedder.embed.mockRejectedValueOnce(new Error("offline"));
    const result = await retrieve("orientation", db, embedder, entity.id);
    expect(result.warning).toContain("text matches only");
    expect(result.references.some(reference => reference.href === "/units/utilitek")).toBe(true);
    expect(result.references.some(reference => reference.href === "/units/other")).toBe(false);
  });
});
