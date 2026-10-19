import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, expect, it, vi } from "vitest";
import type { Database } from "@/lib/database/types";
import { supabaseRpc } from "./rpc";

it("replays a timed-out leased write with the same operation key, but not an ordinary write", async () => {
  vi.useFakeTimers();
  const timeout = { error: { code: "57014", message: "canceling statement due to statement timeout" } };
  const rpc = vi.fn().mockResolvedValueOnce(timeout).mockResolvedValueOnce({ data: { saved: true }, error: null });
  const db = supabaseRpc({ rpc } as unknown as SupabaseClient<Database>);
  const args = { p_event_id: "event", p_token: "owner", p_key: "commit:batch", p_function: "commit_change_set" };
  const result = db.call("upload_workflow_write", args);
  await vi.runAllTimersAsync();
  expect(await result).toEqual({ saved: true });
  expect(rpc.mock.calls).toEqual([["upload_workflow_write", args], ["upload_workflow_write", args]]);
  rpc.mockResolvedValue(timeout);
  await expect(db.call("commit_change_set", {})).rejects.toThrow("statement timeout");
  expect(rpc).toHaveBeenCalledTimes(3);
});

afterEach(() => vi.useRealTimers());

it.each(["claim_upload_workflow", "claim_section_build", "section_build_write", "publish_glossary_meanings", "apply_glossary_auto_decision", "heartbeat_upload_workflow", "assert_upload_lease", "finish_upload_step"])("retries a confirmed rolled-back %s timeout with unchanged ownership arguments", async fn => {
  vi.useFakeTimers();
  const rpc = vi.fn().mockResolvedValueOnce({ error: { code: "57014", message: "canceling statement due to statement timeout" } })
    .mockResolvedValueOnce({ data: { saved: true }, error: null });
  const args = { p_event_id: "event", p_token: "owner", p_section_id: "section", p_function: "commit_change_set" };
  const result = supabaseRpc({ rpc } as unknown as SupabaseClient<Database>).call(fn, args);
  await vi.runAllTimersAsync();
  expect(await result).toEqual({ saved: true });
  expect(rpc.mock.calls).toEqual([[fn, args], [fn, args]]);
});

it.each(["section_build_write", "publish_glossary_meanings", "apply_glossary_auto_decision"])("does not replay an ambiguous %s save or a cancellation", async fn => {
  const rpc = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
  const db = supabaseRpc({ rpc } as unknown as SupabaseClient<Database>);
  await expect(db.call(fn, { p_token: "owner" })).rejects.toThrow("fetch failed");
  rpc.mockResolvedValue({ error: { code: "57014", message: "canceling statement due to user request" } });
  await expect(db.call(fn, { p_token: "owner" })).rejects.toThrow("user request");
  expect(rpc).toHaveBeenCalledTimes(2);
});

it("bounds retries when a processing transaction repeatedly times out", async () => {
  vi.useFakeTimers();
  const rpc = vi.fn().mockResolvedValue({ error: { code: "57014", message: "canceling statement due to statement timeout" } });
  const result = expect(supabaseRpc({ rpc } as unknown as SupabaseClient<Database>).call("claim_upload_workflow")).rejects.toThrow("statement timeout");
  await vi.runAllTimersAsync();
  await result;
  expect(rpc).toHaveBeenCalledTimes(3);
});

it.each(["read_upload_workflows", "heartbeat_upload_workflow"])("recovers a timed-out %s request without confusing it with cancellation", async fn => {
  vi.useFakeTimers();
  const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
  const rpc = vi.fn().mockRejectedValueOnce(timeout)
    .mockResolvedValueOnce({ error: { code: "23", message: "TimeoutError: The operation was aborted due to timeout" } })
    .mockResolvedValueOnce({ data: true, error: null });
  const db = supabaseRpc({ rpc } as unknown as SupabaseClient<Database>);
  const args = { p_event_id: "event", p_token: "original-owner" };
  const result = db.call(fn, args);
  await vi.runAllTimersAsync();
  expect(await result).toBe(true);
  expect(rpc.mock.calls).toEqual([[fn, args], [fn, args], [fn, args]]);
});

it("does not replay ordinary timed-out writes or user cancellation", async () => {
  const rpc = vi.fn().mockResolvedValue({ error: { code: "23", message: "TimeoutError: The operation was aborted due to timeout" } });
  const db = supabaseRpc({ rpc } as unknown as SupabaseClient<Database>);
  await expect(db.call("submit_change_set")).rejects.toThrow("TimeoutError");
  await expect(db.call("heartbeat_upload_workflow", { p_event_id: "event" })).rejects.toThrow("TimeoutError");
  rpc.mockRejectedValue(new DOMException("The operation was aborted", "AbortError"));
  await expect(db.call("read_upload_workflows")).rejects.toThrow("aborted");
  expect(rpc).toHaveBeenCalledTimes(3);
});

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

it.each(["log_ai_call", "submit_change_set", "claim_upload_workflow", "apply_glossary_auto_decision"])("does not replay %s when an empty reply could duplicate work", async (fn) => {
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

it.each(["read_upload_workflows", "finish_upload_step", "upload_workflow_write"])("recovers a lost %s reply using the original fenced operation", async (fn) => {
  vi.useFakeTimers();
  const rpc = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed"))
    .mockResolvedValueOnce({ error: { message: "TypeError: Failed to fetch" }, status: 0 })
    .mockResolvedValueOnce({ data: { saved: true }, error: null });
  const db = supabaseRpc({ rpc } as unknown as SupabaseClient<Database>);
  const args = { p_event_id: "event", p_token: "owner", p_key: "save:original", p_output: { content: "Persisted once" } };
  const result = db.call(fn, args);
  await vi.runAllTimersAsync();
  expect(await result).toEqual({ saved: true });
  expect(rpc.mock.calls).toEqual([[fn, args], [fn, args], [fn, args]]);
});

it.each(["submit_change_set", "claim_upload_workflow", "log_ai_call"])("does not replay an uncertain ordinary %s write after network loss", async (fn) => {
  const rpc = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
  const db = supabaseRpc({ rpc } as unknown as SupabaseClient<Database>);
  await expect(db.call(fn, { p_event_id: "event", p_token: "owner" })).rejects.toThrow("fetch failed");
  expect(rpc).toHaveBeenCalledTimes(1);
});

it("does not retry a programmer error or an unfenced checkpoint after connection loss", async () => {
  const rpc = vi.fn().mockRejectedValue(new TypeError("Cannot read properties of undefined"));
  const db = supabaseRpc({ rpc } as unknown as SupabaseClient<Database>);
  await expect(db.call("read_upload_workflows")).rejects.toThrow("undefined");
  rpc.mockRejectedValue(new TypeError("fetch failed"));
  await expect(db.call("finish_upload_step", { p_event_id: "event" })).rejects.toThrow("fetch failed");
  expect(rpc).toHaveBeenCalledTimes(2);
});

it("replays the same fenced saved answer after an HTML gateway failure without regenerating it", async () => {
  vi.useFakeTimers();
  const rpc = vi.fn().mockResolvedValueOnce({ error: { message: "<!DOCTYPE html><title>Bad Gateway</title>" }, status: 502 })
    .mockResolvedValueOnce({ data: { saved: true }, error: null });
  const args = { p_event_id: "event", p_token: "owner", p_key: "written:section", p_output: { text: "Already generated" } };
  const result = supabaseRpc({ rpc } as unknown as SupabaseClient<Database>).call("finish_upload_step", args);
  await vi.runAllTimersAsync();
  expect(await result).toEqual({ saved: true });
  expect(rpc.mock.calls).toEqual([["finish_upload_step", args], ["finish_upload_step", args]]);
});
it.each(["submit_change_set", "claim_upload_workflow", "log_ai_call"])("does not replay an unfenced %s after an HTML gateway failure", async fn => {
  const rpc = vi.fn().mockResolvedValue({ error: { message: "<!DOCTYPE html>Bad Gateway" }, status: 502 });
  await expect(supabaseRpc({ rpc } as unknown as SupabaseClient<Database>).call(fn, { p_event_id: "event", p_token: "owner" })).rejects.toThrow("Bad Gateway");
  expect(rpc).toHaveBeenCalledTimes(1);
});
