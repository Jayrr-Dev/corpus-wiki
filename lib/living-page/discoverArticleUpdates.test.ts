import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverArticleUpdates, discoveryQueries, discoverySections, repairEmptyIntroductions, groupClaimsForArticle } from "./discoverArticleUpdates";
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
    expect(discoverySections({ sections: [{ title: "Kept", claims: ["C1", "C1", "C2"] }, { title: "Empty", claims: ["C9"] }] }, [candidate], true)).toEqual([{ title: "Kept", query: { unitIds: ["new"], article: true } }]);
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
it("lets related new evidence reuse an existing topic for whole-article planning", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify({ model: "test", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ sections: [{ title: "Requirements", claims: ["C1"] }], excluded: [] }) } }] })));
  vi.stubGlobal("fetch", fetch);
  const result = await groupClaimsForArticle({ apiKey: "test" }, "Example", ["Requirements"], [candidate], "");
  expect(result.sections).toEqual([{ title: "Requirements", query: { unitIds: ["new"], article: true } }]);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("merges the same new topic across discovery batches without losing claims", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    const input = JSON.parse(request.messages.find((message: { role: string }) => message.role === "user").content);
    return new Response(JSON.stringify({ model: "test", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ sections: [{ title: "Detailed behavior", claims: input.claims.map((claim: { ref: string }) => claim.ref) }], excluded: [] }) } }] }));
  });
  vi.stubGlobal("fetch", fetch);
  const candidates = Array.from({ length: 41 }, (_, index) => ({ ...candidate, unitId: `u${index}`, revisionId: `r${index}` }));
  const result = await groupClaimsForArticle({ apiKey: "test" }, "Example", [], candidates, "");
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(result.sections).toHaveLength(1);
  expect(result.sections[0]?.query.unitIds).toHaveLength(41);
});
it("asks again about skipped claims and never saves an unanswered one as turned down", async () => {
  const answers = [
    { sections: [{ title: "First", claims: ["C1"] }], excluded: [] }, { sections: [{ title: "First", claims: ["C1", "C1"] }], excluded: [] },
    { sections: [{ title: "Second", claims: ["C1"] }], excluded: [] }, { sections: [{ title: "Second", claims: ["C1"] }], excluded: [] },
  ];
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response(JSON.stringify({ model: "test", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(answers.shift() ?? { sections: [], excluded: [] }) } }] })));
  vi.stubGlobal("fetch", fetch);
  const result = await groupClaimsForArticle({ apiKey: "test" }, "Example", [], [{ ...candidate, unitId: "a" }, { ...candidate, unitId: "b" }, { ...candidate, unitId: "c" }], "");
  expect(result.sections.map((section) => section.query.unitIds)).toEqual([["a"], ["b"]]);
  expect(result.excluded).toEqual([]);
  expect(fetch).toHaveBeenCalledTimes(6);
});
it("does not loop on a batch the model will not answer", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response(JSON.stringify({ model: "test", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ sections: [], excluded: [] }) } }] })));
  vi.stubGlobal("fetch", fetch);
  await expect(groupClaimsForArticle({ apiKey: "test" }, "Example", [], [candidate], "")).resolves.toMatchObject({ sections: [], excluded: [] });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("discovers relevant new claims using current planning skills and the one-run note", async () => {
  const tables: Record<string, unknown> = {
    pages: { title: "Safety at ExampleCo", scope: "Safety requirements; excludes unrelated company history." },
    sections: [{ id: "section", title: "Safety requirements", mode: "generated", query: { entity, unitIds: ["old"] } }],
    units: [{ id: "new", current_revision_id: "rnew", kind: "fact", epistemic_status: "established" }],
    revisions: [{ id: "rnew", content: candidate.content, knowledge_context: { entities: [{ ...entity, role: "subject" }], applicability: { status: "scoped", entities: [entity], conditions: null } } }],
  };
  const client = { from: (table: string) => {
    const chain = { select: () => chain, eq: () => chain, is: () => chain, in: () => chain, range: () => chain, order: () => chain, single: () => chain, then: (resolve: (result: object) => unknown) => Promise.resolve(resolve({ data: tables[table], error: null })) };
    return chain;
  } } as unknown as import("@/lib/supabase/admin").AdminSupabase;
  const db: import("@/lib/db/rpc").DbRpc = { call: async <T>(name: string, args?: Record<string, unknown>) => (name === "article_knowledge_candidates" ? ["new"] : (args?.p_query as { unitIds?: string[] }).unitIds ? ["old"] : ["old", "new"]) as T };
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

it("remembers excluded claim revisions and offers them again only after the claim, scope or covering text changes", async () => {
  const tables: Record<string, unknown> = {
    pages: { title: "Enneagram", scope: "The system as a whole; per-type profiles belong elsewhere." },
    sections: [{ id: "section", title: "Overview", mode: "generated", query: { unitIds: ["old"] } }],
    units: [{ id: "out", current_revision_id: "rout", kind: "fact", epistemic_status: "established" }, { id: "covered", current_revision_id: "rcovered", kind: "fact", epistemic_status: "established" }],
    revisions: [{ id: "rout", content: "Type Four envies others.", knowledge_context: null }, { id: "rcovered", content: "There are nine types.", knowledge_context: null }, { id: "rout2", content: "Type Four envies others.", knowledge_context: null }],
    section_lines: [{ content: "The Enneagram describes nine types." }],
  };
  const client = { from: (table: string) => {
    let ids: string[] | undefined;
    const chain = { select: () => chain, eq: () => chain, is: () => chain, in: (_column: string, values: string[]) => { ids = values; return chain; }, range: () => chain, order: () => chain, single: () => chain,
      then: (resolve: (result: object) => unknown) => {
        const rows = tables[table];
        return Promise.resolve(resolve({ data: Array.isArray(rows) && ids ? rows.filter(row => ids!.includes(row.id)) : rows, error: null }));
      } };
    return chain;
  } } as unknown as import("@/lib/supabase/admin").AdminSupabase;
  let saved: Record<string, unknown>[] = [];
  const db: import("@/lib/db/rpc").DbRpc = { call: async <T>(name: string, args: Record<string, unknown> = {}) => {
    if (name === "article_knowledge_candidates") return ["out", "covered"] as T;
    if (name === "read_article_judgments") return saved as T;
    if (name === "save_article_judgments") { saved = [...saved.filter(row => !(args.p_judgments as { subject: string }[]).some(item => item.subject === row.subject)), ...(args.p_judgments as object[]).map(item => ({ ...item, stage: args.p_stage }))]; return 1 as T; }
    return ["old"] as T;
  } };
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (_url, init) => {
    const input = JSON.parse(JSON.parse(String(init?.body)).messages.find((message: { role: string }) => message.role === "user").content);
    const excluded = input.claims.map((claim: { ref: string; content: string }) => ({ claim: claim.ref, reason: claim.content.includes("nine") ? "already_covered" : "outside_scope", explanation: "Not for this article." }));
    return new Response(JSON.stringify({ model: "test", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ sections: [], excluded }) } }] }));
  });
  vi.stubGlobal("fetch", fetch);
  const discover = (note = "") => discoverArticleUpdates(db, client, { apiKey: "test" }, "page", note);
  await discover();
  expect(saved.map(row => [row.subject, row.decision])).toEqual([["out", "outside_scope"], ["covered", "already_covered"]]);
  expect(await discover()).toEqual({ sections: [], tokensIn: 0, tokensOut: 0 });
  expect(fetch).toHaveBeenCalledTimes(1);
  // New covering text: only the already-covered claim is judged again.
  tables.section_lines = [{ content: "The Enneagram is a typology." }];
  await discover();
  expect(JSON.parse(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body)).messages.find((message: { role: string }) => message.role === "user").content).claims.map((claim: { content: string }) => claim.content)).toEqual(["There are nine types."]);
  // A revised claim and a person's note are both looked at again.
  (tables.units as { current_revision_id: string }[])[0]!.current_revision_id = "rout2";
  await discover();
  await discover("Include type detail this time.");
  expect(fetch).toHaveBeenCalledTimes(4);
});
