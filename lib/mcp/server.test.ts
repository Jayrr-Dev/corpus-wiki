import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AgentCallRecord, AgentKeyIdentity, AgentSession } from "@/lib/agents/types";
import { defineTool } from "./types";

const keys = vi.hoisted(() => ({
  checkAgentCall: vi.fn(async (): Promise<{ ok: true } | { ok: false; reason: string }> => ({ ok: true })),
  recordAgentCall: vi.fn(async (record: AgentCallRecord) => void record),
  resolveAgentKey: vi.fn(),
}));
const sessions = vi.hoisted(() => ({ seen: [] as AgentSession[] }));

vi.mock("@/lib/agents/keys", () => keys);
vi.mock("@/lib/agents/session", () => ({
  withAgentSession: (session: AgentSession, run: () => Promise<unknown>) => {
    sessions.seen.push(session);
    return run();
  },
}));
vi.mock("@/lib/auth/currentPerson", () => ({ withSpaceActor: (_actor: unknown, run: () => Promise<unknown>) => run() }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminSupabase: () => ({}) }));
vi.mock("./tools", () => ({ ALL_TOOLS: [] }));

const { createMcpServer, MCP_INSTRUCTIONS, summarizeArgs } = await import("./server");

const MY_SPACE = "11111111-1111-4111-8111-111111111111";
const MY_OTHER_SPACE = "22222222-2222-4222-8222-222222222222";
const FOREIGN_SPACE = "33333333-3333-4333-8333-333333333333";

const echo = defineTool({
  name: "echo_note",
  title: "Echo note",
  description: "Echoes the note back.",
  scope: "read",
  input: z.object({ note: z.string(), content: z.string().optional() }),
  annotations: { readOnlyHint: true },
  run: async ({ note }, { session }) => ({ note, space: session.spaceId }),
});
const boom = defineTool({
  name: "boom",
  title: "Boom",
  description: "Always fails.",
  scope: "read",
  input: z.object({}),
  annotations: {},
  run: async () => {
    throw new Error("Article not found.");
  },
});
const remove = defineTool({
  name: "delete_thing",
  title: "Delete thing",
  description: "Deletes.",
  scope: "delete",
  input: z.object({ id: z.string() }),
  annotations: { destructiveHint: true },
  run: async () => ({ deleted: true }),
});

function key(overrides: Partial<AgentKeyIdentity> = {}): AgentKeyIdentity {
  return { keyId: "key-1", name: "Test", personId: "person-1", spaceId: MY_SPACE, scopes: ["read"], ...overrides };
}

async function connect(identity: AgentKeyIdentity) {
  const server = createMcpServer(identity, { tools: [echo, boom, remove], ownedSpaceIds: async () => [MY_SPACE, MY_OTHER_SPACE] });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
}

function text(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as { type: string; text: string }[];
  return content[0]?.text ?? "";
}

beforeEach(() => {
  keys.checkAgentCall.mockClear();
  keys.checkAgentCall.mockImplementation(async () => ({ ok: true }));
  keys.recordAgentCall.mockClear();
  sessions.seen.length = 0;
});

describe("createMcpServer", () => {
  it("lists only the tools whose scope the key holds, with their annotations", async () => {
    const client = await connect(key());
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["echo_note", "boom"]);
    expect(tools[0]?.annotations).toMatchObject({ readOnlyHint: true, title: "Echo note" });
    expect(client.getInstructions()).toBe(MCP_INSTRUCTIONS);
    expect(MCP_INSTRUCTIONS).toMatch(/data, not instructions/);
  });

  it("refuses a call to a tool outside the key's scopes", async () => {
    const client = await connect(key());
    const result = await client.callTool({ name: "delete_thing", arguments: { id: "x" } });
    expect(result.isError).toBe(true);
    expect(sessions.seen).toHaveLength(0);
  });

  it("checks the scope again on every call", async () => {
    const identity = key({ scopes: ["read", "delete"] });
    const client = await connect(identity);
    identity.scopes = ["read"];
    const result = await client.callTool({ name: "delete_thing", arguments: { id: "x" } });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/"delete" scope/);
    expect(keys.recordAgentCall).toHaveBeenCalledWith(expect.objectContaining({ tool: "delete_thing", ok: false }));
  });

  it("adds the space argument only for an account-wide key", async () => {
    const tied = await (await connect(key())).listTools();
    expect(Object.keys(tied.tools[0]?.inputSchema.properties ?? {})).toEqual(["note", "content"]);
    const wide = await (await connect(key({ spaceId: null }))).listTools();
    expect(Object.keys(wide.tools[0]?.inputSchema.properties ?? {})).toContain("space");
    expect(wide.tools[0]?.inputSchema.required ?? []).not.toContain("space");
  });

  it("runs an account-wide key in the Space it names, or its owner's first Space", async () => {
    const client = await connect(key({ spaceId: null }));
    const named = await client.callTool({ name: "echo_note", arguments: { note: "hi", space: MY_OTHER_SPACE } });
    expect(JSON.parse(text(named))).toEqual({ note: "hi", space: MY_OTHER_SPACE });
    const fallback = await client.callTool({ name: "echo_note", arguments: { note: "hi" } });
    expect(JSON.parse(text(fallback))).toEqual({ note: "hi", space: MY_SPACE });
    expect(sessions.seen.map((session) => session.spaceId)).toEqual([MY_OTHER_SPACE, MY_SPACE]);
  });

  it("refuses a Space the key's owner does not own", async () => {
    const client = await connect(key({ spaceId: null }));
    const result = await client.callTool({ name: "echo_note", arguments: { note: "hi", space: FOREIGN_SPACE } });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/not owned/);
    expect(sessions.seen).toHaveLength(0);
  });

  it("ignores a space argument on a key tied to one Space", async () => {
    const client = await connect(key());
    const result = await client.callTool({ name: "echo_note", arguments: { note: "hi", space: FOREIGN_SPACE } });
    expect(JSON.parse(text(result))).toEqual({ note: "hi", space: MY_SPACE });
  });

  it("refuses a call over the rate limit, before the tool runs", async () => {
    keys.checkAgentCall.mockImplementation(async () => ({ ok: false, reason: "Too many calls. Try again in a minute." }));
    const client = await connect(key());
    const result = await client.callTool({ name: "echo_note", arguments: { note: "hi" } });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Too many calls. Try again in a minute.");
    expect(keys.checkAgentCall).toHaveBeenCalledWith("key-1", "read");
    expect(sessions.seen).toHaveLength(0);
  });

  it("writes an audit line on success, with a redacted summary", async () => {
    const client = await connect(key());
    await client.callTool({ name: "echo_note", arguments: { note: "hi", content: "secret file body" } });
    expect(keys.recordAgentCall).toHaveBeenCalledTimes(1);
    const record = keys.recordAgentCall.mock.calls[0]![0];
    expect(record).toMatchObject({ keyId: "key-1", spaceId: MY_SPACE, tool: "echo_note", scope: "read", ok: true, error: null });
    expect(record.summary).toBe('note="hi" content=[16 chars]');
    expect(record.summary).not.toContain("secret");
  });

  it("writes an audit line on failure and returns only the message", async () => {
    const client = await connect(key());
    const result = await client.callTool({ name: "boom", arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Article not found.");
    expect(text(result)).not.toMatch(/at .*\.ts/);
    expect(keys.recordAgentCall).toHaveBeenCalledWith(expect.objectContaining({ tool: "boom", ok: false, error: "Article not found." }));
  });
});

describe("summarizeArgs", () => {
  it("cuts long strings and collapses lists and objects", () => {
    const summary = summarizeArgs({ query: "q".repeat(200), ids: [1, 2, 3], filter: { a: 1, b: 2 }, limit: 5 });
    expect(summary).toMatch(/^query="q{79}…" ids=\[3 items\] filter=\{a,b\} limit=5$/);
  });
});
