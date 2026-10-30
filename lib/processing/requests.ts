import { setTimeout as delay } from "node:timers/promises";
import { createHash } from "node:crypto";
import { RequestPool } from "./concurrency";
import { processingMetric } from "./metrics";
import { uploadExecution } from "@/lib/ingest/workflowContext";

type Workload = "chat" | "embedding" | "search" | "web";
const defaults: Record<Workload, number> = { chat: 3, embedding: 2, search: 4, web: 4 };
const pools = new Map<string, RequestPool>();
export function processingLimit(workload: Workload): number {
  const configured = Number(process.env[`PROCESSING_${workload.toUpperCase()}_CONCURRENCY`] ?? defaults[workload]);
  return Number.isSafeInteger(configured) && configured > 0 && configured <= 32 ? configured : defaults[workload];
}
export async function withRequestSlot<T>(workload: Workload, provider: string, credential: string, run: (signal?: AbortSignal) => Promise<T>, signal = uploadExecution.getStore()?.signal): Promise<T> {
  const key = `${workload}:${provider}:${createHash("sha256").update(credential).digest("hex")}`;
  let pool = pools.get(key);
  if (!pool) { pool = new RequestPool(processingLimit(workload)); pools.set(key, pool); }
  const started = performance.now();
  return pool.run(async () => {
    processingMetric(`queue.${workload}`, performance.now() - started);
    if (process.env.PROCESSING_SHARED_LIMITS !== "true") return run(signal);
    return withSharedSlot(key, processingLimit(workload), run, signal);
  }, signal);
}

async function withSharedSlot<T>(scope: string, limit: number, run: (signal?: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const [{ getAdminSupabase }, { supabaseRpc }] = await Promise.all([import("@/lib/supabase/admin"), import("@/lib/db/rpc")]);
  const db = supabaseRpc(getAdminSupabase());
  const started = performance.now();
  let token: string | null;
  do {
    signal?.throwIfAborted();
    token = await db.call<string | null>("claim_processing_slot", { p_scope: scope, p_limit: limit });
    if (!token) await delay(250, undefined, { signal });
  } while (!token);
  processingMetric("queue.shared", performance.now() - started);
  const abort = new AbortController();
  const effective = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
  let pending = false;
  const heartbeat = setInterval(() => {
    if (pending) return;
    pending = true;
    void db.call<boolean>("renew_processing_slot", { p_scope: scope, p_token: token })
      .then((owned) => { if (!owned) abort.abort(new Error("Provider request ownership expired.")); })
      .catch((error) => abort.abort(error)).finally(() => { pending = false; });
  }, 30_000);
  heartbeat.unref?.();
  try { effective.throwIfAborted(); const value = await run(effective); effective.throwIfAborted(); return value; }
  finally {
    clearInterval(heartbeat);
    try { await db.call("release_processing_slot", { p_scope: scope, p_token: token }); }
    catch { processingMetric("provider.release-failed"); }
  }
}

// Retry only explicit transient HTTP responses, never validation failures or a
// lost network reply (which may already have performed work at the provider).
export async function fetchWithRetry(url: string | URL, init: RequestInit, attempts = 3): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    init.signal?.throwIfAborted();
    const response = await fetch(url, init);
    if (![429, 502, 503, 504, 529].includes(response.status) || attempt >= attempts - 1) return response;
    const retryAfter = response.headers.get("retry-after");
    const seconds = retryAfter === null ? NaN : Number(retryAfter);
    const requested = Number.isFinite(seconds) ? seconds * 1000 : retryAfter ? Date.parse(retryAfter) - Date.now() : NaN;
    // A long provider cooldown should surface as an error, rather than silently
    // exceeding the request's execution budget.
    if (Number.isFinite(requested) && requested > 30_000) return response;
    await response.body?.cancel();
    processingMetric(response.status === 429 ? "provider.throttled" : "provider.retry");
    await delay(Math.max(0, Number.isFinite(requested) ? requested : 250 * 2 ** attempt + Math.random() * 100), undefined, { signal: init.signal ?? undefined });
  }
}
