import { setTimeout as delay } from "node:timers/promises";
import { processingMetric } from "@/lib/processing/metrics";

const RETRY_DELAYS = [250, 500, 1000, 2000, 4000, 8000, 15000];

// A database restart can produce an empty HTTP 400 before schema-cache errors.
// GET/HEAD requests are safe to replay; writes retain the RPC port's narrower
// transaction/ownership rules. Keep one timeout signal across all attempts.
export async function fetchDatabaseRead(input: RequestInfo | URL, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (!url.includes("/rest/v1/") || !["GET", "HEAD"].includes(method)) return fetcher(input, init);
  const signal = init.signal ?? (input instanceof Request ? input.signal : undefined);
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    let response: Response;
    try { response = await fetcher(input, init); }
    catch (error) {
      signal?.throwIfAborted();
      if (!(error instanceof TypeError) || attempt >= RETRY_DELAYS.length) throw error;
      processingMetric("db.read.retry");
      await delay(RETRY_DELAYS[attempt], undefined, { signal: signal ?? undefined });
      continue;
    }
    let interrupted = [502, 503, 504].includes(response.status);
    if (response.status === 400) {
      const body = await response.clone().json().catch(() => null) as { code?: string; message?: string; details?: string; hint?: string } | null;
      interrupted = body !== null && !body.code && !body.message?.trim() && !body.details?.trim() && !body.hint?.trim();
    }
    if (!interrupted) return response;
    if (attempt >= RETRY_DELAYS.length) {
      throw new Error(`Database read failed (HTTP ${response.status}). The connection is unavailable; completed work is saved and can be resumed.`);
    }
    await response.body?.cancel();
    processingMetric("db.read.retry");
    await delay(RETRY_DELAYS[attempt], undefined, { signal: signal ?? undefined });
  }
}
