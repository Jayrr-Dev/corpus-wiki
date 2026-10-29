import { afterEach, describe, expect, it, vi } from "vitest";
import type { DraftChangeSet, ExistingUnit, ReconciliationInput } from "@/lib/ai/types";
import { cosine, wordSet } from "@/lib/knowledge/similarity";
import { TokenFactoryReconciliationClient } from "./client";
import type { NeighborhoodStore } from "./neighborhood";
import { SplitReconciliationClient, type ExtractionCache, type SplitPorts } from "./splitClient";

// =====================================================================
// THE SPLIT CLIENT AGAINST A SCRIPTED MODEL (no network, no paid calls).
// The model reads one claim per passage. With a store in its prompt (the
// current client) it revises a unit that says the same words; resolution
// answers "same" for a neighbor that says the same words. So both clients
// should reach the same actions, and the numbers show what each sends.
// =====================================================================

type Body = { messages: { role: string; content: string }[]; response_format: { json_schema: { name: string } } };
const bodyOf = (options: RequestInit) => JSON.parse(String(options.body)) as Body;
const userOf = <T>(body: Body) => JSON.parse(body.messages.at(-1)!.content) as T;
const reply = (value: unknown) => new Response(JSON.stringify({
  model: "scripted", usage: { prompt_tokens: 10, completion_tokens: 5 },
  choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }],
}));
const acme = { type: "company", key: "acme", name: "Acme", role: "subject" } as const;

// THE SCRIPTED MODEL; calls records every request by name with its prompt size
function scriptedModel(delayMs = 0) {
  const calls: { name: string; chars: number; body: Body }[] = [];
  let active = 0, peak = 0;
  const fetchMock = vi.fn(async (_url: unknown, options: RequestInit) => {
    const body = bodyOf(options);
    const name = body.response_format.json_schema.name;
    calls.push({ name, chars: body.messages.reduce((sum, message) => sum + message.content.length, 0), body });
    active++; peak = Math.max(peak, active);
    try {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (name === "reconciliation") {
        const payload = userOf<{ existingUnits: { ref: string; content: string }[]; passages: { ref: string; text: string }[] }>(body);
        return reply({ summary: "Read policies", links: [], claims: payload.passages.map((passage) => {
          const same = payload.existingUnits.find((unit) => unit.content === passage.text);
          return { action: same ? "revise" : "add", unit: same?.ref ?? null, content: passage.text, title: "Policy", kind: "fact", epistemicStatus: "supported",
            speechAct: "stated", passages: [passage.ref], entities: [acme], domainPaths: [], reason: "Policy" };
        }) });
      }
      if (name === "reconciliation_resolution") {
        const payload = userOf<{ neighbors: { ref: string; content: string }[]; claims: { ref: string; content: string; neighbors: string[] }[] }>(body);
        return reply({ links: [], decisions: payload.claims.map((claim) => {
          const same = claim.neighbors.find((ref) => payload.neighbors.find((neighbor) => neighbor.ref === ref)?.content === claim.content);
          return { claim: claim.ref, decision: same ? "same" : "new", target: same ?? null, reason: same ? "Already known." : "New." };
        }) });
      }
      return reply({ duplicateOf: null, reason: "Different." });
    } finally { active--; }
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, peak: () => peak, named: (name: string) => calls.filter((call) => call.name === name) };
}

// A word vector: texts sharing words point the same way (enough for nearest-neighbor tests)
const DIMENSIONS = 64;
function vectorOf(text: string): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  for (const word of wordSet(text)) vector[[...word].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % DIMENSIONS, 7)]! += 1;
  return vector;
}

// THE STORE IN MEMORY: the units have vectors; units() also finds claims saved after the input was read
function memoryPorts(units: ExistingUnit[], cache?: ExtractionCache): SplitPorts & { searches: number } {
  const ports = {
    searches: 0,
    store: {
      embed: async (texts: string[]) => texts.map(vectorOf),
      similar: async (vector: readonly number[], limit: number) => {
        ports.searches++;
        return units.map((unit) => ({ unitId: unit.unitId, similarity: cosine(vector, vectorOf(unit.content)) }))
          .filter((row) => row.similarity >= 0.55).sort((a, b) => b.similarity - a.similarity).slice(0, limit);
      },
      units: async (ids: string[]) => units.filter((unit) => ids.includes(unit.unitId)),
    } satisfies NeighborhoodStore,
    cache: cache ?? null,
  };
  return ports;
}

function memoryCache(): ExtractionCache & { saved: Map<string, unknown> } {
  const saved = new Map<string, unknown>();
  return { saved, read: async (key) => (saved.get(key) as never) ?? null, save: async (key, answer) => { saved.set(key, answer); } };
}

// A store of n claims about Acme, and a file whose passages repeat `repeated` of them word for word
const unitsOf = (count: number): ExistingUnit[] => Array.from({ length: count }, (_, index) => ({
  unitId: `unit-${index}`, revisionId: `rev-${index}`, content: `Acme rule ${index} covers ${["ladders", "gloves", "helmets", "permits", "fire drills"][index % 5]} at site ${index}.`,
  kind: "fact", epistemicStatus: "supported", sourceDate: "2026-10-01T00:00:00Z", passageIds: [`old-${index}`],
  context: { entities: [{ type: "company", key: "acme", role: "subject" }], applicability: { status: "unspecified", entities: [], conditions: null } },
}));
function inputOf(units: ExistingUnit[], texts: string[], chars = 0): ReconciliationInput {
  return {
    source: { id: "source", title: "handbook.pdf", sourceDate: "2026-10-14T00:00:00Z" }, fileTopicsLater: true,
    passages: texts.map((text, index) => ({ id: `passage-${index}`, position: index, text: chars ? text.padEnd(chars, ".") : text, speakerLabel: null })),
    existingUnits: units, domainPaths: [], entities: [{ type: "company", key: "acme", name: "Acme" }],
  };
}
const fileTexts = (units: ExistingUnit[]) => [
  units[3]!.content, "Acme requires a buddy for every confined space entry.", units[7]!.content,
  "Acme bans phones on the shop floor.", "Acme logs every visitor at the front desk.",
];
const summarize = (draft: DraftChangeSet) => draft.actions.filter((action) => action.type !== "create_entity").map((action) =>
  action.type === "revise_claim" ? `revise ${action.targetId} ${action.passageIds.join(",")}` : action.type === "add_claim" ? `add ${action.input.content} ${action.passageIds.join(",")}` : action.type);

afterEach(() => vi.unstubAllGlobals());

describe("split reconciliation", () => {
  it("reaches the same actions as the current client, with prompts that do not grow with the store", async () => {
    const sizes: { store: number; current: number; extraction: number; resolution: number }[] = [];
    for (const count of [20, 200, 2000]) {
      const units = unitsOf(count);
      const input = inputOf(units, fileTexts(units));
      const current = scriptedModel();
      const before = await new TokenFactoryReconciliationClient({ apiKey: "test" }).draftChangeSet(input);
      const split = scriptedModel();
      const after = await new SplitReconciliationClient({ apiKey: "test" }, () => memoryPorts(units)).draftChangeSet(input);
      expect(summarize(after)).toEqual(summarize(before));
      expect(summarize(after).filter((line) => line.startsWith("revise"))).toEqual(["revise unit-3 old-3,passage-0", "revise unit-7 old-7,passage-2"]);
      const max = (calls: { chars: number }[]) => Math.max(0, ...calls.map((call) => call.chars));
      sizes.push({ store: count, current: max(current.named("reconciliation")), extraction: max(split.named("reconciliation")), resolution: max(split.named("reconciliation_resolution")) });
    }
    // The current prompt carries the whole store; the split prompts stay the same size
    expect(sizes[2]!.current).toBeGreaterThan(sizes[0]!.current * 10);
    expect(new Set(sizes.map((size) => size.extraction)).size).toBe(1);
    expect(Math.max(...sizes.map((size) => size.resolution))).toBeLessThan(sizes[0]!.current * 2);
    console.info("Reconcile prompt characters by store size", sizes);
  });

  it("asks nothing for a claim with no neighbors and gives the entity judge the nearest claims, most alike first", async () => {
    const units = unitsOf(50);
    const input = inputOf(units, ["Zebra crossings are painted white.", units[12]!.content.replace("Acme", "Acme Industries")]);
    input.entities.push({ type: "company", key: "acme-industries", name: "Acme Industries" });
    const model = scriptedModel();
    const realFetch = globalThis.fetch as unknown as (url: unknown, options: RequestInit) => Promise<Response>;
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, options: RequestInit) => {
      const body = bodyOf(options);
      if (body.response_format.json_schema.name !== "reconciliation") return realFetch(url, options);
      const answer = JSON.parse((await (await realFetch(url, options)).json()).choices[0].message.content);
      answer.claims[1].entities = [{ type: "company", key: "acme-industry", name: "Acme Industry", role: "subject" }];
      answer.claims[0].entities = [];
      return reply(answer);
    }));
    await new SplitReconciliationClient({ apiKey: "test" }, () => memoryPorts(units)).draftChangeSet(input);
    const resolution = model.named("reconciliation_resolution");
    expect(resolution).toHaveLength(1);
    expect(userOf<{ claims: unknown[] }>(resolution[0]!.body).claims).toHaveLength(1);
    const judge = model.named("entity_duplicate_review")[0]!;
    const knowledge = userOf<{ context: { existingKnowledge: { content: string }[] } }>(judge.body).context.existingKnowledge;
    const draft = vectorOf(input.passages[1]!.text.replace("Acme Industries", "Acme Industry"));
    const alike = knowledge.map((unit) => cosine(draft, vectorOf(unit.content)));
    expect(knowledge.map((unit) => unit.content)).toContain(units[12]!.content);
    expect(alike).toEqual([...alike].sort((a, b) => b - a));
    expect(knowledge.length).toBeLessThanOrEqual(12);
  });

  it("reads batches in parallel and costs nothing when the same text is processed again", async () => {
    const units = unitsOf(10);
    const texts = Array.from({ length: 120 }, (_, index) => `Acme note ${index} about topic ${index}.`);
    const input = inputOf(units, texts, 200);
    const cache = memoryCache();
    const first = scriptedModel(20);
    await new SplitReconciliationClient({ apiKey: "test" }, () => memoryPorts(units, cache)).draftChangeSet(input);
    const batches = first.named("reconciliation").length;
    expect(batches).toBeGreaterThan(3);
    expect(first.peak()).toBeGreaterThan(1);
    expect(cache.saved.size).toBe(batches);
    // A re-upload names its passages anew: the cache is keyed by their text
    const again = { ...input, passages: input.passages.map((passage) => ({ ...passage, id: `new-${passage.id}` })) };
    const second = scriptedModel();
    const draft = await new SplitReconciliationClient({ apiKey: "test" }, () => memoryPorts(units, cache)).draftChangeSet(again);
    expect(second.named("reconciliation")).toHaveLength(0);
    expect(draft.actions.filter((action) => action.type === "add_claim")).toHaveLength(120);
  });

  it("cites a fact repeated later in the file on the earlier claim, and publishes it once", async () => {
    const units = unitsOf(5);
    const repeated = "Acme requires a buddy for every confined space entry.";
    const texts = [repeated, ...Array.from({ length: 50 }, (_, index) => `Acme note ${index} about topic ${index}.`), repeated];
    const input = inputOf(units, texts, 150);
    const model = scriptedModel();
    const published: DraftChangeSet[] = [];
    const draft = await new SplitReconciliationClient({ apiKey: "test" }, () => memoryPorts(units)).draftChangeSet(input, async (_key, batch) => {
      published.push(batch);
      return batch.actions.map((action, position) => ({ position, type: action.type, outcome: "applied", unitId: action.type === "add_claim" ? `saved-${action.passageIds[0]}` : null }));
    });
    expect(published.length).toBeGreaterThan(1);
    const adds = published.flatMap((batch) => batch.actions).filter((action) => action.type === "add_claim");
    const buddy = adds.filter((action) => action.type === "add_claim" && action.input.content.startsWith(repeated));
    expect(buddy).toHaveLength(1);
    expect(buddy[0]!.passageIds).toEqual(["passage-0", `passage-${texts.length - 1}`]);
    expect(adds).toHaveLength(texts.length - 1);
    // Nothing left to save after the batches: no revisions, no links
    expect(draft.actions).toEqual([]);
    expect(model.named("reconciliation_resolution").length).toBeGreaterThan(0);
  });

  it("keeps a claim when resolution answers nothing for it", async () => {
    const units = unitsOf(10);
    const input = inputOf(units, [units[2]!.content]);
    scriptedModel();
    const realFetch = globalThis.fetch as unknown as (url: unknown, options: RequestInit) => Promise<Response>;
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, options: RequestInit) =>
      bodyOf(options).response_format.json_schema.name === "reconciliation_resolution" ? reply({ decisions: [], links: [] }) : realFetch(url, options)));
    const draft = await new SplitReconciliationClient({ apiKey: "test" }, () => memoryPorts(units)).draftChangeSet(input);
    expect(summarize(draft)).toEqual([`add ${units[2]!.content} passage-0`]);
  });
});
