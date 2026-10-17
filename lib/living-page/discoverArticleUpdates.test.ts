import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverArticleUpdates, discoveryQueries, discoverySections, repairEmptyIntroductions } from "./discoverArticleUpdates";
import { articleUpdateSchema } from "./updateRequest";

const entity = { type: "company", key: "example" };
const candidate = { unitId: "new", revisionId: "rnew", content: "New requirement.", kind: "fact" as const, epistemicStatus: "established" as const };
describe("article update discovery boundaries", () => {
  it("searches beyond fixed IDs only within existing entity, domain and kind scope", () => {
    expect(discoveryQueries([{ unitIds: ["old"], entity, domainPaths: ["Example/Safety"], kinds: ["fact"] }, { unitIds: ["orphan"] }, {}, { entity }])).toEqual([{ entity, domainPaths: ["Example/Safety"], kinds: ["fact"] }]);
  });
  it("allows no new relevant information, and maps only real claim refs", () => {
    expect(discoverySections({ sections: [] }, [candidate])).toEqual([]);
    expect(discoverySections({ sections: [{ title: "New requirements", claims: ["C1"] }] }, [candidate])).toEqual([{ title: "New requirements", query: { unitIds: ["new"], article: true } }]);
    expect(discoverySections({ sections: [{ title: "New requirements", claims: [" c1 "] }] }, [candidate])[0]?.query.unitIds).toEqual(["new"]);
    expect(() => discoverySections({ sections: [{ title: "Invented", claims: ["C2"] }] }, [candidate])).toThrow("unknown");
    expect(() => discoverySections({ sections: [{ title: "Duplicate", claims: ["C1", "C1"] }] }, [candidate])).toThrow("repeated");
    expect(() => discoverySections({ sections: [{ title: "Duplicate", claims: ["C1", " c1 "] }] }, [candidate])).toThrow("repeated");
  });
  it("bounds one-run notes and rejects malformed targets", () => {
    const request = { scope: "section", id: "10000000-0000-4000-8000-000000000001", note: " Short paragraphs. " };
    expect(articleUpdateSchema.parse(request).note).toBe("Short paragraphs.");
    expect(articleUpdateSchema.safeParse({ ...request, note: "x".repeat(2001) }).success).toBe(false);
    expect(articleUpdateSchema.safeParse({ ...request, id: "not-an-id" }).success).toBe(false);
  });
});


afterEach(() => vi.unstubAllGlobals());
it("discovers relevant new claims using current planning skills and the one-run note", async () => {
  const tables: Record<string, unknown> = {
    pages: { title: "Safety at ExampleCo", scope: "Safety requirements; excludes unrelated company history." },
    sections: [{ id: "section", title: "Safety requirements", mode: "generated", query: { entity, unitIds: ["old"] } }],
    units: [{ id: "new", current_revision_id: "rnew", kind: "fact", epistemic_status: "established" }],
    revisions: [{ id: "rnew", content: candidate.content, knowledge_context: { entities: [{ ...entity, role: "subject" }], applicability: { status: "scoped", entities: [entity], conditions: null } } }],
  };
  const client = { from: (table: string) => {
    const chain = { select: () => chain, eq: () => chain, is: () => chain, in: () => chain, order: () => chain, single: () => chain, then: (resolve: (result: object) => unknown) => Promise.resolve(resolve({ data: tables[table], error: null })) };
    return chain;
  } } as unknown as import("@/lib/supabase/admin").AdminSupabase;
  const db: import("@/lib/db/rpc").DbRpc = { call: async <T>(_name: string, args?: Record<string, unknown>) => ((args?.p_query as { unitIds?: string[] }).unitIds ? ["old"] : ["old", "new"]) as T };
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify({ model: "test", usage: { prompt_tokens: 120, completion_tokens: 30 }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ sections: [{ title: "New requirement", claims: ["C1"] }] }) } }] })));
  vi.stubGlobal("fetch", fetch);
  const result = await discoverArticleUpdates(db, client, { apiKey: "test", skills: { plan_articles: { id: "custom", name: "Planning", version: 4, instructions: "CUSTOM_PLAN_INSTRUCTIONS" } } }, "page", "Explain new requirements clearly.");
  expect(result.sections[0]?.query.unitIds).toEqual(["new"]);
  expect(result).toMatchObject({ tokensIn: 120, tokensOut: 30 });
  const request = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
  expect(request.messages.filter((message: { role: string }) => message.role === "system").map((message: { content: string }) => message.content).join(" ")).toContain("CUSTOM_PLAN_INSTRUCTIONS");
  const user = JSON.parse(request.messages.find((message: { role: string }) => message.role === "user").content);
  expect(user.note).toBe("Explain new requirements clearly.");
  expect(user.scope).toBe("Safety requirements; excludes unrelated company history.");
  expect(user.claims).toEqual([{ ref: "C1", content: candidate.content, status: "established", context: { entities: [{ ...entity, role: "subject" }], applicability: { status: "scoped", entities: [entity], conditions: null } } }]);
});

it("repairs an empty definition-only lead from scoped current facts, preserving manual leads", async () => {
  const chain = { select: () => chain, eq: () => chain, is: async () => ({ error: null, data: [{ id: "overview", title: "Overview", mode: "generated", query: { entity, kinds: ["definition"], article: true } }] }) };
  const client = { from: () => chain } as unknown as import("@/lib/supabase/admin").AdminSupabase;
  let manual = false;
  const call = vi.fn(async (name: string) => name === "read_section_state" ? { units: [], lines: manual ? [{ author: "person" }] : [] } : ["current-fact"]);
  const db = { call: call as import("@/lib/db/rpc").DbRpc["call"] };
  const actions = await repairEmptyIntroductions(db, client, "page");
  expect(actions.map((action) => action.type)).toEqual(["retire_section", "create_section"]);
  expect(actions[1]?.input).toMatchObject({ title: "Overview", query: { entity, unitIds: ["current-fact"] } });
  expect((actions[1]?.input as { query: object }).query).not.toHaveProperty("kinds");
  manual = true;
  expect(await repairEmptyIntroductions(db, client, "page")).toEqual([]);
});
