import "server-only";
import { setTimeout as delay } from "node:timers/promises";
import { uploadExecution } from "@/lib/ingest/workflowContext";

// Only temporary availability failures qualify. Invalid answers, bad requests,
// lost ownership and cancellation must remain visible to their caller.
export function isGlossaryInterruption(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 3) return false;
  const value = error as { name?: string; message?: string; code?: string; status?: number; cause?: unknown };
  if (value.name === "AbortError" || /cancelled|canceled|took over/i.test(value.message ?? "")) return false;
  if ([400, 401, 403, 404, 422].includes(value.status ?? 0) || (typeof value.code === "string" && /^(?:22|23|42)/.test(value.code))) return false;
  return [408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526].includes(value.status ?? 0)
    || value.name === "TimeoutError" || /^TimeoutError:.*tim(?:e|ed)\s*out/i.test(value.message ?? "")
    || value.code === "25P02"
    || /canceling statement due to statement timeout/i.test(value.message ?? "")
    || /current transaction is aborted, commands ignored until end of transaction block/i.test(value.message ?? "")
    || /unexpected NULL detoast result/i.test(value.message ?? "")
    || /^(?:08\w{3}|57P0[123]|PGRST00[012])$/.test(value.code ?? "")
    || /fetch failed|failed to fetch|network(?:error| request failed)|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up|upstream connect error|disconnect\/reset|connection (?:closed|reset|terminated|termination)|Database read failed \(HTTP (?:502|503|504)\)|\b(?:502|503|504)\b.*(?:gateway|unavailable|upstream)/i.test(value.message ?? "")
    || isGlossaryInterruption(value.cause, depth + 1);
}

// Callers use this for reads, fenced checkpoints and AI requests; ordinary
// database writes must never be replayed after an ambiguous response.
export async function retryGlossaryOperation<T>(run: () => PromiseLike<T>, delays: readonly number[] = [1000, 4000, 10000], signal: AbortSignal | null | undefined = uploadExecution.getStore()?.signal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try { return await run(); }
    catch (error) {
      signal?.throwIfAborted();
      if (!isGlossaryInterruption(error) || attempt >= delays.length) throw error;
      await delay(delays[attempt], undefined, { signal: signal ?? undefined });
    }
  }
}
