import { expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { mapConcurrent, RequestPool } from "@/lib/processing/concurrency";

// Offline scheduling replay, not a measurement of live AI quality or production latency.
const fixtures = [
  { name: "short document", groups: [2, 2], limit: 3 },
  { name: "long document", groups: [24, 12], limit: 3 },
  { name: "update existing knowledge", groups: [4, 3], limit: 3 },
  { name: "several pages", groups: [8], limit: 3 },
  { name: "one page with many ordered sections", groups: [1], limit: 3, sections: 12 },
  { name: "stakeholder research", groups: [8], limit: 2 },
  { name: "embedding requests", groups: [8], limit: 2 },
  { name: "two uploads sharing a request budget", groups: [12, 12], limit: 3, simultaneous: true },
];
async function replay(fixture: typeof fixtures[number], limit: number) {
  const completed: string[] = [];
  const start = performance.now();
  const pool = new RequestPool(limit);
  let active = 0, peak = 0;
  const group = async (stage: number, count: number) => {
    await mapConcurrent(Array.from({ length: count }, (_, index) => index), limit, (index) => pool.run(async () => {
      active++; peak = Math.max(peak, active);
      for (let section = 0; section < (fixture.sections ?? 1); section++) {
        await new Promise((resolve) => setTimeout(resolve, 3));
        completed.push(`${stage}:${index}:${section}`);
      }
      active--;
    }));
  };
  if (fixture.simultaneous) await Promise.all(fixture.groups.map((count, stage) => group(stage, count)));
  else for (const [stage, count] of fixture.groups.entries()) await group(stage, count);
  expect(peak).toBeLessThanOrEqual(limit);
  return { durationMs: performance.now() - start, completed: completed.sort() };
}
it.runIf(process.env.PROCESSING_BENCHMARK === "1")("records paired sequential and bounded scheduling replays", async () => {
  const results = [];
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
  for (const fixture of fixtures) {
    const baseline: number[] = [], optimized: number[] = [];
    for (let repeat = 0; repeat < 5; repeat++) {
      const before = await replay(fixture, 1);
      const after = await replay(fixture, fixture.limit);
      expect(after.completed).toEqual(before.completed);
      baseline.push(before.durationMs); optimized.push(after.durationMs);
    }
    results.push({ fixture: fixture.name, repetitions: 5, sequentialMedianMs: Math.round(median(baseline)), boundedMedianMs: Math.round(median(optimized)), workers: fixture.limit,
      improvementPercent: Math.round((1 - median(optimized) / median(baseline)) * 100) });
  }
  await mkdir("artifacts/processing", { recursive: true });
  await writeFile("artifacts/processing/scheduling-benchmark.json", JSON.stringify({ kind: "offline synthetic scheduling replay", generatedAt: new Date().toISOString(), results }, null, 2) + "\n");
});
