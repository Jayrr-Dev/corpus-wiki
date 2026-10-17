import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, expect, it, vi } from "vitest";
import type { Database } from "@/lib/database/types";
import { supabaseRpc } from "./rpc";

afterEach(() => vi.useRealTimers());

it("recovers a transient read statement timeout without replaying timed-out writes", async () => {
  vi.useFakeTimers();
  const timeout = { error: { code: "57014", message: "canceling statement due to statement timeout" }, status: 500 };
  const rpc = vi.fn().mockResolvedValueOnce(timeout).mockResolvedValueOnce({ data: { pages: [] }, error: null });
  const db = supabaseRpc({ rpc } as unknown as SupabaseClient<Database>);
  const read = db.call("curator_snapshot");
  await vi.runAllTimersAsync();
  expect(await read).toEqual({ pages: [] });
  rpc.mockResolvedValue(timeout);
  await expect(db.call("submit_change_set")).rejects.toThrow("statement timeout");
  expect(rpc).toHaveBeenCalledTimes(3);
});

it.each(["missing_glossary_embeddings", "get_glossary_auto_decide"])("retries the read-only %s without requiring an upload ownership token", async (fn) => {
  vi.useFakeTimers();
  const rpc = vi.fn().mockResolvedValueOnce({ error: { message: "", code: "" }, status: 400 })
    .mockResolvedValueOnce({ data: [], error: null });
  const db = supabaseRpc({ rpc } as unknown as SupabaseClient<Database>);
  const args = fn === "missing_glossary_embeddings" ? { p_model: "embedding-model", p_limit: 64 } : {};
  const result = db.call(fn, args);
  await vi.runAllTimersAsync();
  expect(await result).toEqual([]);
  expect(rpc.mock.calls).toEqual([[fn, args], [fn, args]]);
});

it("retries an empty release response using the same ownership token", async () => {
  vi.useFakeTimers();
  const rpc = vi.fn().mockResolvedValueOnce({ error: { message: "", code: "" }, status: 502 })
    .mockResolvedValueOnce({ data: false, error: null });
  const db = supabaseRpc({ rpc } as unknown as SupabaseClient<Database>);
  const args = { p_event_id: "event", p_token: "owner", p_state: "complete" };
  const result = db.call("release_upload_workflow", args);
  await vi.runAllTimersAsync();
  expect(await result).toBe(false);
  expect(rpc.mock.calls).toEqual([["release_upload_workflow", args], ["release_upload_workflow", args]]);
});

it("reports HTTP details for empty errors without retrying other writes", async () => {
  const rpc = vi.fn().mockResolvedValue({ error: { message: "" }, status: 502, statusText: "Bad Gateway" });
  const db = supabaseRpc({ rpc } as unknown as SupabaseClient<Database>);
  await expect(db.call("submit_change_set")).rejects.toThrow("submit_change_set: 502 Bad Gateway");
  expect(rpc).toHaveBeenCalledTimes(1);
});

it("does not retry a database rejection of a release", async () => {
  const rpc = vi.fn().mockResolvedValue({ error: { message: "Invalid workflow state", code: "P0001" } });
  const db = supabaseRpc({ rpc } as unknown as SupabaseClient<Database>);
  await expect(db.call("release_upload_workflow")).rejects.toThrow("Invalid workflow state");
  expect(rpc).toHaveBeenCalledTimes(1);
});

it.each(["assert_upload_lease", "start_upload_step", "finish_upload_step", "report_upload_progress", "upload_workflow_write"])("replays %s after an empty database interruption with the original ownership arguments", async (fn) => {
  vi.useFakeTimers();
  const rpc = vi.fn().mockResolvedValueOnce({ error: { message: "", code: "", details: null, hint: null }, status: 400 })
    .mockResolvedValueOnce({ data: { saved: true }, error: null });
  const db = supabaseRpc({ rpc } as unknown as SupabaseClient<Database>);
  const args = { p_event_id: "event", p_token: "owner", p_key: "operation", p_output: { generated: "answer" } };
  const result = db.call(fn, args);
  await vi.runAllTimersAsync();
  expect(await result).toEqual({ saved: true });
  expect(rpc.mock.calls).toEqual([[fn, args], [fn, args]]);
});

it.each(["log_ai_call", "submit_change_set", "claim_upload_workflow"])("does not replay %s when an empty reply could duplicate work", async (fn) => {
  const rpc = vi.fn().mockResolvedValue({ error: { message: "", code: "" }, status: 400, statusText: "Bad Request" });
  const db = supabaseRpc({ rpc } as unknown as SupabaseClient<Database>);
  await expect(db.call(fn, { p_event_id: "event", p_token: "owner" })).rejects.toThrow("400 Bad Request");
  expect(rpc).toHaveBeenCalledTimes(1);
});

it("does not retry cancellation, authentication failures or unowned checkpoint writes", async () => {
  const rpc = vi.fn().mockResolvedValue({ error: { message: "Processing was cancelled.", code: "P0001" }, status: 400 });
  const db = supabaseRpc({ rpc } as unknown as SupabaseClient<Database>);
  await expect(db.call("assert_upload_lease", { p_event_id: "event", p_token: "owner" })).rejects.toThrow("cancelled");
  rpc.mockResolvedValue({ error: { message: "", code: "" }, status: 401 });
  await expect(db.call("assert_upload_lease", { p_event_id: "event", p_token: "owner" })).rejects.toThrow("401");
  rpc.mockResolvedValue({ error: { message: "", code: "" }, status: 400 });
  await expect(db.call("finish_upload_step", { p_event_id: "event" })).rejects.toThrow("400");
  expect(rpc).toHaveBeenCalledTimes(3);
});
