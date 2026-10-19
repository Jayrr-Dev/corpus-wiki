import { beforeEach, expect, it, vi } from "vitest";
import type { AdminSupabase } from "@/lib/supabase/admin";
import type { DbRpc } from "@/lib/db/rpc";
import { uploadExecution } from "@/lib/ingest/workflowContext";
import { waitForGlossaryPublisher } from "./generationWait";

const { pause } = vi.hoisted(() => ({ pause: vi.fn() }));
vi.mock("node:timers/promises", () => ({ setTimeout: pause }));
beforeEach(() => pause.mockReset());
type State = { status: string; input_hash: string | null; lease_until: string | null };
function clientFor(state: State) {
  const read = vi.fn(async () => ({ data: { ...state }, error: null }));
  const query = { select: () => query, eq: () => query, single: read };
  return { client: { from: () => query } as unknown as AdminSupabase, read };
}

it("keeps the upload pending until another worker publishes matching knowledge", async () => {
  const state: State = { status: "generating", input_hash: null, lease_until: new Date(Date.now() + 600_000).toISOString() };
  const { client, read } = clientFor(state);
  let release!: () => void;
  pause.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  let settled = false;
  const running = waitForGlossaryPublisher(client, "wanted").finally(() => { settled = true; });
  await vi.waitFor(() => expect(pause).toHaveBeenCalledTimes(1));
  expect(settled).toBe(false);
  state.status = "ready"; state.input_hash = "wanted"; state.lease_until = null;
  release();
  await expect(running).resolves.toBe(false);
  expect(read).toHaveBeenCalledTimes(2);
});

it.each([
  [{ status: "ready", input_hash: "wanted", lease_until: null }, false],
  [{ status: "ready", input_hash: "newer", lease_until: null }, true],
  [{ status: "generating", input_hash: null, lease_until: "2000-01-01T00:00:00Z" }, true],
  [{ status: "error", input_hash: null, lease_until: null }, true],
] as const)("distinguishes publication from an interrupted or superseded generator", async (state, retry) => {
  await expect(waitForGlossaryPublisher(clientFor(state).client, "wanted")).resolves.toBe(retry);
  expect(pause).not.toHaveBeenCalled();
});

it("cancels its wait without modifying another worker's state", async () => {
  const state: State = { status: "generating", input_hash: null, lease_until: new Date(Date.now() + 600_000).toISOString() };
  const original = { ...state };
  const abort = new AbortController();
  pause.mockImplementationOnce((_ms, _value, { signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })));
  const db = { call: vi.fn(async () => null) } as unknown as DbRpc;
  const running = uploadExecution.run({ eventId: "upload", token: "owner", db, signal: abort.signal }, () => waitForGlossaryPublisher(clientFor(state).client, "wanted"));
  const rejection = expect(running).rejects.toThrow("Cancelled");
  await vi.waitFor(() => expect(pause).toHaveBeenCalledTimes(1));
  abort.abort(new Error("Cancelled"));
  await rejection;
  expect(state).toEqual(original);
});
