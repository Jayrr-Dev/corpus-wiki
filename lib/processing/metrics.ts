import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

export type Metric = { count: number; durationMs: number; failures: number; tokensIn: number; tokensOut: number };
export type ProcessingReport = { eventId: string; job: string; startedAt: string; finishedAt: string; durationMs: number; status: "succeeded" | "failed" | "cancelled" | "waiting" | "incomplete"; metrics: Record<string, Metric> };
const context = new AsyncLocalStorage<Map<string, Metric>>();

// Deliberately excludes prompts, source text, subjects, request bodies and credentials.
export function processingMetric(name: string, durationMs = 0, values: { failed?: boolean; tokensIn?: number | null; tokensOut?: number | null } = {}): void {
  const metrics = context.getStore();
  if (!metrics) return;
  const entry = metrics.get(name) ?? { count: 0, durationMs: 0, failures: 0, tokensIn: 0, tokensOut: 0 };
  entry.count++;
  entry.durationMs += durationMs;
  entry.failures += Number(values.failed ?? false);
  entry.tokensIn += values.tokensIn ?? 0;
  entry.tokensOut += values.tokensOut ?? 0;
  metrics.set(name, entry);
}

export async function processingSpan<T>(name: string, run: () => Promise<T>): Promise<T> {
  const started = performance.now();
  let failed = true;
  try { const result = await run(); failed = false; return result; }
  finally { processingMetric(name, performance.now() - started, { failed }); }
}

export async function withProcessingReport<T>(eventId: string, job: string, run: () => Promise<T>, report: (value: ProcessingReport) => void = (value) => console.info("Processing run metrics", JSON.stringify(value)), outcome: (value: T) => ProcessingReport["status"] = () => "succeeded"): Promise<T> {
  return context.run(new Map(), async () => {
    const startedAt = new Date().toISOString();
    const started = performance.now();
    let status: ProcessingReport["status"] = "failed";
    try { const result = await run(); status = outcome(result); return result; }
    finally {
      const metrics = Object.fromEntries([...context.getStore()!].map(([name, metric]) => [name, { ...metric, durationMs: Math.round(metric.durationMs) }]));
      try { report({ eventId, job, startedAt, finishedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started), status, metrics }); }
      catch { /* Observability cannot change an upload's outcome. */ }
    }
  });
}
