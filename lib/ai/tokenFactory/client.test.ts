import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReconciliationInput } from "@/lib/ai/types";
import { TokenFactoryReconciliationClient } from "./client";

const input = (count: number, chars = 20): ReconciliationInput => ({
  source: { id: "source", title: "handbook.pdf", sourceDate: "2026-10-14T00:00:00Z" },
  passages: Array.from({ length: count }, (_, index) => ({ id: `passage-${index}`, position: index, text: String(index).padEnd(chars, "x"), speakerLabel: null })),
  existingUnits: [], domainPaths: [], entities: [],
});
const client = () => new TokenFactoryReconciliationClient({ apiKey: "test" });
const bodyOf = (options: RequestInit) => JSON.parse(String(options.body));
const passagesOf = (options: RequestInit): { ref: string; text: string }[] => JSON.parse(bodyOf(options).messages.at(-1).content).passages;
const response = (options: RequestInit) => new Response(JSON.stringify({
  model: "nvidia/nemotron-3-super-120b-a12b",
  usage: { prompt_tokens: 10, completion_tokens: 20 },
  choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ summary: "Read policies", claims: passagesOf(options).map((passage) => ({
    action: "add", unit: null, content: passage.text, title: "Policy", kind: "fact", epistemicStatus: "supported", speechAct: "stated",
    passages: [passage.ref], entities: [{ type: "company", key: "acme", name: "Acme", role: "subject" }], domainPaths: ["Policies"], reason: "New policy",
  })),
  // Every batch links its second claim to its first, by this batch's own claim refs
  links: passagesOf(options).length > 1 ? [{ from: "C2", to: "C1", type: "related_to", reason: "Same policy" }] : [] }) } }],
}));

afterEach(() => vi.unstubAllGlobals());

describe("batched reconciliation", () => {
  it("covers every passage, preserves citations across batches and creates shared entities/domains once", async () => {
    const fetchMock = vi.fn(async (_url: unknown, options: RequestInit) => response(options));
    vi.stubGlobal("fetch", fetchMock);
    const draft = await client().draftChangeSet(input(17));
    expect(fetchMock.mock.calls.map(([, options]) => passagesOf(options).length)).toEqual([8, 8, 1]);
    const claims = draft.actions.filter((action) => action.type === "add_claim");
    expect(claims.map((action) => action.passageIds)).toEqual(input(17).passages.map((passage) => [passage.id]));
    expect(draft.actions.filter((action) => action.type === "create_entity")).toHaveLength(1);
    expect(draft.actions.filter((action) => action.type === "create_domain")).toHaveLength(1);
    expect(draft.trace).toMatchObject({ tokensIn: 30, tokensOut: 60, promptVersion: "reconcile-v6" });
  });

  it("renumbers each batch's claim refs so links point at the right claims", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, options: RequestInit) => response(options)));
    const draft = await client().draftChangeSet(input(17));
    // create_domain and create_entity take positions 0 and 1, so claim n sits at position n + 1
    const links = draft.actions.filter((action) => action.type === "link").map((action) => action.input);
    expect(links).toEqual([
      { toUnitId: null, type: "related_to", fromPosition: 3, toPosition: 2, rationale: "Same policy" },
      { toUnitId: null, type: "related_to", fromPosition: 11, toPosition: 10, rationale: "Same policy" },
    ]);
  });

  it("also bounds batches by text length", async () => {
    const fetchMock = vi.fn(async (_url: unknown, options: RequestInit) => response(options));
    vi.stubGlobal("fetch", fetchMock);
    await client().draftChangeSet(input(3, 4000));
    expect(fetchMock.mock.calls).toHaveLength(3);
  });

  it("splits a truncated batch, discards its partial answer and includes failed-call usage", async () => {
    const fetchMock = vi.fn(async (_url: unknown, options: RequestInit) => response(options));
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({
      choices: [{ finish_reason: "length", message: { content: null } }], usage: { prompt_tokens: 40, completion_tokens: 8000 },
    })));
    vi.stubGlobal("fetch", fetchMock);
    const draft = await client().draftChangeSet(input(4));
    expect(fetchMock.mock.calls.map(([, options]) => passagesOf(options).length)).toEqual([4, 2, 2]);
    expect(draft.actions.filter((action) => action.type === "add_claim").map((action) => action.passageIds)).toEqual(input(4).passages.map((passage) => [passage.id]));
    expect(draft.trace).toMatchObject({ tokensIn: 60, tokensOut: 8040 });
  });

  it("stops at one passage rather than retrying forever or silently saving an incomplete document", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: null } }] })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(client().draftChangeSet(input(2))).rejects.toThrow("ran out of room");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry unrelated provider errors", async () => {
    const fetchMock = vi.fn(async () => new Response("Unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(client().draftChangeSet(input(4))).rejects.toThrow("503");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
