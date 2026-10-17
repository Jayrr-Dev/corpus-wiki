import { describe, expect, it, vi } from "vitest";
import { dedupeGlossaryEntries, reviewGlossaryDuplicates } from "./dedupe";
import { type GlossaryEntry } from "./entries";
import { roleForPurpose } from "../ai/roles";

const entry = (term: string, values: Partial<GlossaryEntry> = {}): GlossaryEntry => ({
  term, expansion: null, aliases: [], category: "general term", definition: "A product intended for use in the home.",
  context: null, scopeKey: "[null]", citations: [{ unitId: "u1", revisionId: "r1", sourceId: "s1", sourceTitle: "Handbook" }], ...values,
});

describe("glossary duplicate guard", () => {
  it("runs independent checks beyond a cluster of dependent terms without exceeding three calls", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let independentStarted!: () => void;
    const independent = new Promise<void>((resolve) => { independentStarted = resolve; });
    let active = 0, peak = 0;
    const inputs = [entry("Apple orchard", { usageNotes: [] }), entry("Hydraulic valve", { usageNotes: [] }),
      ...Array.from({ length: 4 }, (_, i) => entry("Apple orchard", { usageNotes: [], definition: `A distinct description of orchard number ${i}.` })),
      entry("Hydraulic valve", { usageNotes: [], definition: "A mechanism regulating fluid in a hydraulic circuit." })];
    const run = dedupeGlossaryEntries(inputs, async (proposed) => {
      peak = Math.max(peak, ++active);
      try {
        if (proposed.term === "Hydraulic valve") independentStarted();
        else await gate;
        return { duplicateOf: null, definition: null, relationship: "different_meaning" };
      } finally { active--; }
    }, undefined, { concurrency: 3 });
    try {
      await independent;
      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(3);
    } finally { release(); }
    expect(await run).toHaveLength(inputs.length);
  });

  it("waits for a preceding merge before judging a dependent candidate", async () => {
    const seen: string[] = [];
    const updated = "A household product with an additional supported qualification.";
    const inputs = [entry("Consumer product", { usageNotes: [] }),
      entry("Consumer products", { definition: "A household product needing an additional qualification.", usageNotes: [] }),
      entry("Consumer product", { definition: "Another supported description of a household product.", usageNotes: [] })];
    const result = await dedupeGlossaryEntries(inputs, async (proposed, candidates) => {
      if (proposed === inputs[2]) seen.push(candidates[0]!.definition);
      return { duplicateOf: 0, definition: updated, relationship: "same_meaning" };
    }, undefined, { concurrency: 3 });
    expect(result).toHaveLength(1);
    expect(seen).toEqual([updated]);
    expect(result[0]?.definition).toBe(updated);
  });

  it("caches completed comparisons independently of generated meaning IDs", async () => {
    const decisions: Record<string, unknown> = {};
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ duplicateOf: 0,
      definition: "A household product with its supported meaning intact.", relationship: "same_meaning", reason: "Same meaning.", usageNotes: [] }) } }] })));
    vi.stubGlobal("fetch", fetchMock);
    try {
      for (const suffix of ["first", "resumed"]) await reviewGlossaryDuplicates([
        entry("Consumer product", { meaningId: suffix, usageNotes: [] }), entry("Consumer products", { usageNotes: [] }),
      ], { apiKey: "test", model: "test" }, async () => {}, { decisionCache: decisions });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(Object.keys(decisions)).toHaveLength(1);
    } finally { vi.unstubAllGlobals(); }
  });

  it("holds an invalid model comparison for review instead of losing the whole dictionary", async () => {
    const pending: import("./entries").PendingGlossaryEntry[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "{" } }] }))));
    try {
      const result = await reviewGlossaryDuplicates([entry("Consumer product", { meaningId: "kept", usageNotes: [] }),
        entry("Consumer products", { meaningId: "pending", usageNotes: [] })], { apiKey: "test", model: "test" }, async () => {}, { pending });
      expect(result).toHaveLength(1);
      expect(pending[0]).toMatchObject({ entry: { meaningId: "pending" }, relationship: "uncertain" });
    } finally { vi.unstubAllGlobals(); }
  });
  it("does not rejudge two previously reviewed meanings but checks a new proposal against them", async () => {
    const judge = vi.fn(async () => ({ duplicateOf: null, definition: null, relationship: "different_meaning" as const }));
    const established = [entry("Bank", { meaningId: "financial", established: true, usageNotes: [] }), entry("Bank", { meaningId: "river", established: true, usageNotes: [] })];
    await dedupeGlossaryEntries(established, judge);
    expect(judge).not.toHaveBeenCalled();
    await dedupeGlossaryEntries([...established, entry("Banks", { usageNotes: [] })], judge);
    expect(judge).toHaveBeenCalledTimes(1);
  });
  it("consolidates the four-gas example into one meaning plus attributed usage, and caches separation", async () => {
    const canonical = "An instrument that measures oxygen, flammable gas, carbon monoxide and hydrogen sulfide.";
    const cache: Record<string, GlossaryEntry[]> = {};
    const inputs = [entry("Four-gas monitor", { meaningId: "general", definition: canonical }), entry("Four-gas monitor", {
      meaningId: "local", definition: "Brightwater's attendant uses a calibrated instrument to monitor four gases during entry.", context: "Brightwater utilities ltd · Confined space entries", scopeKey: '[["brightwater"]]',
    })];
    const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const payload = JSON.parse(body.messages.at(-1).content);
      const value = body.response_format.json_schema.name === "glossary_canonicalize"
        ? { definition: canonical, usageNotes: payload.entry.context ? [{ context: "Brightwater utilities ltd", text: "The attendant monitors the atmosphere throughout entry.", citations: ["S1"] }] : [] }
        : { duplicateOf: 0, definition: canonical, relationship: "usage_detail", reason: "Same instrument with an attributed usage example.", usageNotes: [{ context: "Brightwater utilities ltd", text: "The attendant monitors the atmosphere throughout entry.", citations: ["S1"] }] };
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] }));
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await reviewGlossaryDuplicates(inputs, { apiKey: "test", model: "test" }, async () => {}, { normalizationCache: cache });
      expect(result).toHaveLength(1);
      expect(result[0]?.definition).toBe(canonical);
      expect(result[0]?.usageNotes).toMatchObject([{ context: "Brightwater utilities ltd", text: "The attendant monitors the atmosphere throughout entry.", citations: inputs[1]!.citations }]);
      expect(Object.keys(cache)).toHaveLength(2);
      fetchMock.mockClear();
      await reviewGlossaryDuplicates(inputs, { apiKey: "test", model: "test" }, async () => {}, { normalizationCache: cache });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });

  it("shortlists synonyms by cosine similarity and retains separately cited usage notes", async () => {
    const note = { context: "Utilitek Solutions Inc.", text: "Utilitek tries elimination first.", citations: entry("Hierarchy").citations };
    const judge = vi.fn(async () => ({ duplicateOf: 0, relationship: "same_meaning" as const, definition: "An ordered approach to reducing hazards from elimination to personal protective equipment." }));
    const result = await dedupeGlossaryEntries([entry("Hazard control hierarchy", { meaningId: "first", usageNotes: [] }),
      entry("Risk reduction ladder", { meaningId: "second", usageNotes: [note] })], judge, undefined, { vectors: [[1, 0], [0.99, 0.01]] });
    expect(judge).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0]?.usageNotes).toEqual([note]);
    expect(result[0]?.meaningId).toBe("first");
    expect(result[0]?.redirectIds).toContain("second");
    expect(result[0]?.definition).not.toContain("Utilitek");
  });

  it.each(["uncertain", "conflicting_evidence"] as const)("holds %s matches for review instead of publishing another definition", async (relationship) => {
    const pending: import("./entries").PendingGlossaryEntry[] = [];
    const result = await dedupeGlossaryEntries([entry("Monitor", { meaningId: "existing", usageNotes: [] }), entry("Monitors", { meaningId: "proposed", usageNotes: [] })],
      async () => ({ duplicateOf: null, definition: null, relationship, reason: "Check the evidence." }), undefined, { pending });
    expect(result).toHaveLength(1);
    expect(pending).toMatchObject([{ entry: { meaningId: "proposed" }, candidateIds: ["existing"], relationship }]);
  });

  it("preserves a manual definition when new usage is merged", async () => {
    const result = await dedupeGlossaryEntries([entry("Monitor", { definition: "A person's corrected definition.", personEdited: true, usageNotes: [] }), entry("Monitors", { usageNotes: [] })],
      async () => ({ duplicateOf: 0, definition: "The AI would prefer this phrasing.", relationship: "usage_detail" }));
    expect(result[0]?.definition).toBe("A person's corrected definition.");
  });
  it("reviews singular/plural candidates and preserves combined meaning, aliases and evidence", async () => {
    const combined = "A product intended for use in the home, labelled under other legislation rather than WHMIS.";
    const judge = vi.fn(async () => ({ duplicateOf: 0, definition: combined }));
    const heartbeat = vi.fn(async () => {});
    const result = await dedupeGlossaryEntries([entry("Consumer product"), entry("Consumer products", {
      definition: "Products labelled under other legislation rather than WHMIS.", aliases: ["Consumer goods"],
      citations: [{ unitId: "u2", revisionId: "r2", sourceId: "s2", sourceTitle: "Training" }],
    })], judge, heartbeat);
    expect(judge).toHaveBeenCalledTimes(1);
    expect(heartbeat).toHaveBeenLastCalledWith({ phase: "comparing", completed: 2, total: 2 });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ term: "Consumer product", definition: combined, aliases: ["Consumer goods", "Consumer products"] });
    expect(result[0]?.citations.map((cite) => cite.sourceId)).toEqual(["s1", "s2"]);
  });

  it("keeps different senses even when their headwords match exactly", async () => {
    const judge = vi.fn(async () => ({ duplicateOf: null, definition: null }));
    const result = await dedupeGlossaryEntries([entry("Bank"), entry("Bank", { definition: "The land alongside a river." })], judge);
    expect(judge).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(2);
  });

  it("skips AI for unrelated terms, different scopes and conflicting acronym expansions", async () => {
    const judge = vi.fn(async () => ({ duplicateOf: 0, definition: "Should never run." }));
    const entries = [entry("Consumer product", { scopeKey: '[["other-company"]]' }), entry("Zebra"), entry("Consumer products", { scopeKey: '[["acme"]]' }),
      entry("PPE", { expansion: "Personal protective equipment" }), entry("PPE", { expansion: "Property plant and equipment" })];
    expect(await dedupeGlossaryEntries(entries, judge)).toHaveLength(5);
    expect(judge).not.toHaveBeenCalled();
  });

  it("finds aliases and expansions and updates the index after a confirmed merge", async () => {
    const judge = vi.fn(async () => ({ duplicateOf: 0, definition: "Equipment worn to reduce exposure to hazards." }));
    const result = await dedupeGlossaryEntries([
      entry("PPE", { expansion: "Personal protective equipment" }),
      entry("Personal protective equipment", { aliases: ["Safety kit"] }), entry("Safety kit"),
    ], judge);
    expect(result).toHaveLength(1);
    expect(judge).toHaveBeenCalledTimes(2);
  });

  it("unions compatible entity scopes and lets the AI reject an incompatible general meaning", async () => {
    const judge = vi.fn(async (proposed: GlossaryEntry) => proposed.scopeKey === "[null]"
      ? { duplicateOf: null, definition: null }
      : { duplicateOf: 0, definition: "Equipment used within the specified organizations." });
    const result = await dedupeGlossaryEntries([entry("Safety kit", { scopeKey: '[["acme"]]' }),
      entry("Safety kits", { scopeKey: '[["acme","city"]]' }), entry("Safety kit")], judge);
    expect(result).toHaveLength(2);
    expect(result.map((item) => item.scopeKey)).toContain('[["acme","city"]]');
    expect(judge).toHaveBeenCalledTimes(2);
  });

  it.each(["Four-gas monitor", "Hazard control hierarchy"])("reviews general and local explanations of %s in either order", async (term) => {
    const general = entry(term);
    const local = entry(term, { context: "Brightwater utilities ltd · Confined space entries", scopeKey: '[["brightwater"]]',
      aliases: ["Alternate name"], definition: "Brightwater uses this equipment during confined space entry.",
      citations: [{ unitId: "u2", revisionId: "r2", sourceId: "s2", sourceTitle: "Brightwater" }] });
    const combined = "A shared general meaning. At Brightwater, its use follows the stated local practice.";
    for (const inputs of [[general, local], [local, general]]) {
      const judge = vi.fn(async () => ({ duplicateOf: 0, definition: combined }));
      const result = await dedupeGlossaryEntries(inputs, judge);
      expect(judge).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ definition: combined, scopeKey: '[null,["brightwater"]]', context: local.context, aliases: ["Alternate name"] });
      expect(result[0]?.citations).toHaveLength(2);
    }
  });

  it("rejects invalid merge references and missing combined definitions", async () => {
    for (const decision of [{ duplicateOf: 7, definition: "A combined definition." }, { duplicateOf: 0, definition: null }]) {
      await expect(dedupeGlossaryEntries([entry("Product"), entry("Products")], async () => decision)).rejects.toThrow("invalid merge");
    }
  });

  it("routes low-effort review through the dictionary editor with bounded candidate references", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: {
      content: JSON.stringify({ duplicateOf: 0, definition: "A product intended for use in the home.", relationship: "same_meaning", reason: "Same meaning.", usageNotes: [] }),
    }, finish_reason: "stop" }] })));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await reviewGlossaryDuplicates([entry("Product", { usageNotes: [] }), entry("Products", { usageNotes: [] })], {
        apiKey: "workspace", model: "default", roleRoutes: { dictionary_editor: { apiKey: "dictionary", model: "review-model" } },
      }, async () => {});
      expect(result).toHaveLength(1);
      expect(roleForPurpose("glossary_duplicate_review")).toBe("dictionary_editor");
      const init = (fetchMock.mock.calls[0] as unknown as [URL, RequestInit])[1];
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({ model: "review-model", reasoning_effort: "low", max_tokens: 8000 });
      expect(body.response_format.json_schema.schema.properties.duplicateOf.anyOf[0].maximum).toBe(0);
    } finally { vi.unstubAllGlobals(); }
  });
});
