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
  it("checks entity and domain variants before assigning action positions", async () => {
    const source = input(2);
    source.entities = [{ type: "company", key: "acme-industries", name: "Acme Industries" }];
    source.domainPaths = ["Acme", "Acme/Inspection"];
    const fetchMock = vi.fn(async (_url: unknown, options: RequestInit) => {
      const body = bodyOf(options);
      if (body.response_format.json_schema.name !== "reconciliation") {
        return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ duplicateOf: 0, reason: "Same identity and scope." }) } }] }));
      }
      const payload = await response(options).json();
      const answer = JSON.parse(payload.choices[0].message.content);
      for (const claim of answer.claims) {
        claim.entities = [{ type: "company", key: "acme-industry", name: "Acme Industry", role: "subject" }];
        claim.applicability = { status: "scoped", entities: [{ type: "company", key: "acme-industry", name: "Acme Industry" }], conditions: "On site" };
        claim.domainPaths = ["Acme/Inspections"];
      }
      payload.choices[0].message.content = JSON.stringify(answer);
      return new Response(JSON.stringify(payload));
    });
    vi.stubGlobal("fetch", fetchMock);
    const draft = await client().draftChangeSet(source);
    expect(fetchMock.mock.calls.map(([, options]) => bodyOf(options).response_format.json_schema.name))
      .toEqual(["reconciliation", "entity_duplicate_review", "domain_duplicate_review"]);
    expect(draft.actions.map((action) => action.type)).toEqual(["add_claim", "add_claim", "link"]);
    expect(draft.actions[0]?.input).toMatchObject({ domainPaths: ["Acme/Inspection"], context: {
      entities: [{ type: "company", key: "acme-industries", role: "subject" }],
      applicability: { entities: [{ type: "company", key: "acme-industries" }], conditions: "On site" },
    } });
    expect(draft.actions[2]?.input).toMatchObject({ fromPosition: 1, toPosition: 0 });
  });
  it("does not erase invalid citations while translating batch references", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, options: RequestInit) => {
      const payload = await response(options).json();
      const answer = JSON.parse(payload.choices[0].message.content);
      answer.claims[0].passages.push("P999");
      payload.choices[0].message.content = JSON.stringify(answer);
      return new Response(JSON.stringify(payload));
    }));
    await expect(client().draftChangeSet(input(1))).rejects.toThrow("unknown passage");
  });
  it("saves a source-backed acronym definition separately from the rule that uses it", async () => {
    const source = input(1);
    source.passages[0]!.text = "Personal Protective Equipment (PPE) protects workers. Workers must wear PPE on site.";
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, options: RequestInit) => {
      const body = bodyOf(options);
      const instructions = body.messages.map((message: { content: string }) => message.content).join("\n");
      expect(instructions).toContain("Assigned skill for define_concepts");
      expect(instructions).toContain("Make a separate terminology sweep");
      const base = {
        action: "add", unit: null, epistemicStatus: "supported", speechAct: "stated", passages: ["P1"],
        entities: [], domainPaths: [], reason: "The source explains PPE.",
      };
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
        summary: "Defined PPE and recorded its use.", links: [], claims: [
          { ...base, kind: "definition", title: "PPE: Personal Protective Equipment", content: "PPE stands for Personal Protective Equipment, which protects workers." },
          { ...base, kind: "fact", title: "PPE required on site", content: "Workers must wear PPE on site." },
        ],
      }) } }] }));
    }));
    const draft = await client().draftChangeSet(source);
    expect(draft.actions.filter((action) => action.type === "add_claim")).toMatchObject([
      { passageIds: ["passage-0"], input: { kind: "definition", title: "PPE: Personal Protective Equipment" } },
      { passageIds: ["passage-0"], input: { kind: "fact" } },
    ]);
  });

  it("covers every passage, preserves citations across batches and creates shared entities/domains once", async () => {
    const fetchMock = vi.fn(async (_url: unknown, options: RequestInit) => response(options));
    vi.stubGlobal("fetch", fetchMock);
    const draft = await client().draftChangeSet(input(81));
    expect(fetchMock.mock.calls.map(([, options]) => passagesOf(options).length)).toEqual([40, 40, 1]);
    const claims = draft.actions.filter((action) => action.type === "add_claim");
    expect(claims.map((action) => action.passageIds)).toEqual(input(81).passages.map((passage) => [passage.id]));
    expect(draft.actions.filter((action) => action.type === "create_entity")).toHaveLength(1);
    expect(draft.actions.filter((action) => action.type === "create_domain")).toHaveLength(1);
    expect(draft.trace).toMatchObject({ tokensIn: 30, tokensOut: 60, promptVersion: "reconcile-v13-entity-types+name-duplicate-v2" });
  });

  it("lets a later batch continue a procedure an earlier batch started", async () => {
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, options: RequestInit) => {
      const sent = JSON.parse(bodyOf(options).messages.at(-1).content);
      const base = { unit: null, title: "Step", epistemicStatus: "supported", speechAct: "stated", entities: [], domainPaths: [], reason: "" };
      const passage = sent.passages[0].ref;
      call += 1;
      const answer = call === 1
        ? { summary: "Started", claims: [
            { ...base, action: "add", kind: "procedure", content: "Acme deploys in two steps.", passages: [passage], structure: { type: "sequence", complete: true, mode: null } },
            { ...base, action: "add", kind: "procedure", content: "Acme builds the release.", passages: [passage] }],
          links: [{ from: "C2", to: "C1", type: "part_of", position: 1, reason: "" }] }
        : (expect(sent.earlierComposites).toEqual([{ ref: "G1", content: "Acme deploys in two steps.", structure: { type: "sequence", complete: true, mode: null }, lastPosition: 1 }]),
          { summary: "Finished", claims: [{ ...base, action: "add", kind: "procedure", content: "Acme ships the release.", passages: [passage] }],
            links: [{ from: "C1", to: "G1", type: "part_of", position: 2, reason: "" }] });
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(answer) } }] }));
    }));
    const draft = await client().draftChangeSet(input(2, 4000));
    expect(call).toBe(2);
    const links = draft.actions.filter((action) => action.type === "link");
    expect(links.map((link) => link.type === "link" && [link.input.fromPosition, link.input.toPosition, link.input.memberPosition])).toEqual([[1, 0, 1], [2, 0, 2]]);
  });

  it("renumbers each batch's claim refs so links point at the right claims", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, options: RequestInit) => response(options)));
    const draft = await client().draftChangeSet(input(81));
    // create_domain and create_entity take positions 0 and 1, so claim n sits at position n + 1
    const links = draft.actions.filter((action) => action.type === "link").map((action) => action.input);
    expect(links).toEqual([
      { toUnitId: null, type: "related_to", fromPosition: 3, toPosition: 2, rationale: "Same policy" },
      { toUnitId: null, type: "related_to", fromPosition: 43, toPosition: 42, rationale: "Same policy" },
    ]);
  });

  it("reads at low reasoning effort", async () => {
    const fetchMock = vi.fn(async (_url: unknown, options: RequestInit) => response(options));
    vi.stubGlobal("fetch", fetchMock);
    await new TokenFactoryReconciliationClient({ apiKey: "test", model: "zai-org/GLM-5.3-Flash" }).draftChangeSet(input(2));
    expect(bodyOf(fetchMock.mock.calls[0]![1]).reasoning_effort).toBe("low");
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

  it("splits a batch the provider never answered instead of failing the upload", async () => {
    const fetchMock = vi.fn(async (_url: unknown, options: RequestInit) => response(options));
    fetchMock.mockImplementationOnce(async () => { throw new DOMException("Timed out", "TimeoutError"); });
    vi.stubGlobal("fetch", fetchMock);
    const draft = await client().draftChangeSet(input(4));
    expect(fetchMock.mock.calls.map(([, options]) => passagesOf(options).length)).toEqual([4, 2, 2]);
    expect(draft.actions.filter((action) => action.type === "add_claim").map((action) => action.passageIds)).toEqual(input(4).passages.map((passage) => [passage.id]));
  });

  it("stops at one passage rather than retrying forever or silently saving an incomplete document", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: null } }] })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(client().draftChangeSet(input(2))).rejects.toThrow("ran out of room");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry unrelated provider errors", async () => {
    const fetchMock = vi.fn(async () => new Response("Bad request", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(client().draftChangeSet(input(4))).rejects.toThrow("400");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
