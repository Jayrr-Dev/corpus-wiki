"use client";

import { useMemo, useRef, useState } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { ReasoningEffort } from "@/lib/ai/chat";
import { roleName } from "@/lib/ai/roles";
import type { StoredSpeedTest } from "@/lib/ai/speedTest";
import { testModelSpeed } from "@/lib/server-actions/settings";
import type { ModelSettings } from "./loadModelSettings";

// =====================================================================
// AI SPEED: a live test of every model the providers offer. One short
// answer per run, timed on the server: latency (wait for the first token)
// and speed (tokens per second after it). Every run is stored, so the
// table opens with each model's latest numbers.
// =====================================================================

type Row = { model: string; uses: string[] };
type Sort = "in_use" | "speed" | "latency" | "name";

// The efforts real calls run at: medium first, low when an answer runs out of room
const EFFORTS: { value: ReasoningEffort; label: string }[] = [{ value: "medium", label: "Medium" }, { value: "low", label: "Low" }];
const effortLabel = (effort: StoredSpeedTest["effort"]) => (effort === "off" ? "Thinking off" : `Ran at ${EFFORTS.find((option) => option.value === effort)?.label ?? effort}`);

// HOW MANY RUNS Test all keeps going at once (every model at once would trip provider rate limits)
const PARALLEL_RUNS = 6;

// Models in use first (active, then each role's own), then every other offered model, then any tested model no longer offered
function allRows(settings: ModelSettings, saved: Record<string, StoredSpeedTest>): Row[] {
  const rows = new Map<string, string[]>([[settings.activeModel, ["Active model"]]]);
  for (const [role, model] of Object.entries(settings.roleModels)) {
    if (model) rows.set(model, [...(rows.get(model) ?? []), roleName(role)]);
  }
  for (const model of [...settings.models, ...Object.keys(saved)]) if (!rows.has(model)) rows.set(model, []);
  return [...rows].map(([model, uses]) => ({ model, uses }));
}

// Fastest / lowest latency first; untested and failed models sink to the bottom
function sortRows(rows: Row[], sort: Sort, tests: Record<string, StoredSpeedTest>): Row[] {
  if (sort === "in_use") return rows;
  if (sort === "name") return [...rows].sort((a, b) => a.model.localeCompare(b.model, undefined, { sensitivity: "base" }));
  const score = (row: Row) => {
    const test = tests[row.model];
    if (sort === "speed") return test?.tokensPerSecond ?? -Infinity;
    return test?.latencyMs == null ? -Infinity : -test.latencyMs;
  };
  return [...rows].sort((a, b) => score(b) - score(a));
}

const ms = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value} ms`);
const testedAt = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function AiSpeed({ settings, saved }: { settings: ModelSettings; saved: Record<string, StoredSpeedTest> }) {
  const test = useServerAction(testModelSpeed, { progress: false });
  const [tests, setTests] = useState<Record<string, StoredSpeedTest>>(saved);
  const [running, setRunning] = useState<ReadonlySet<string>>(new Set());
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const stopRequested = useRef(false);
  const [efforts, setEfforts] = useState<Record<string, ReasoningEffort>>({});
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("in_use");
  // Starts at the effort real calls run at: the one picked on /settings, else medium
  const effortFor = (model: string) => efforts[model] ?? settings.effort ?? "medium";

  const rows = useMemo(() => allRows(settings, saved), [settings, saved]);
  const needle = query.trim().toLowerCase();
  const shown = sortRows(needle ? rows.filter((row) => row.model.toLowerCase().includes(needle)) : rows, sort, tests);

  const run = async (model: string) => {
    setRunning((current) => new Set(current).add(model));
    const outcome = await test.run(model, effortFor(model));
    if (outcome.ok) setTests((current) => ({ ...current, [model]: outcome.test }));
    setRunning((current) => {
      const next = new Set(current);
      next.delete(model);
      return next;
    });
  };

  // Every shown model, PARALLEL_RUNS at a time; each row fills in as its own answer finishes
  const runAll = async () => {
    const queue = shown.map((row) => row.model);
    stopRequested.current = false;
    setBatch({ done: 0, total: queue.length });
    const worker = async () => {
      for (let model = queue.shift(); model && !stopRequested.current; model = queue.shift()) {
        await run(model);
        setBatch((current) => (current ? { ...current, done: current.done + 1 } : current));
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_RUNS, queue.length) }, worker));
    setBatch(null);
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-panel text-muted-foreground">Each run asks for a ~150-word paragraph and times the answer as it streams in. Results are saved.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="h-9 min-w-48 flex-1" placeholder={`Search ${rows.length} models…`} value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search models" />
        <NativeSelect aria-label="Sort models" value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
          <NativeSelectOption value="in_use">In use first</NativeSelectOption>
          <NativeSelectOption value="speed">Fastest</NativeSelectOption>
          <NativeSelectOption value="latency">Lowest latency</NativeSelectOption>
          <NativeSelectOption value="name">Name</NativeSelectOption>
        </NativeSelect>
        {batch ? (
          <Button type="button" variant="outline" onClick={() => (stopRequested.current = true)}>
            Stop ({batch.done}/{batch.total})
          </Button>
        ) : (
          <Button type="button" disabled={shown.length === 0} onClick={() => void runAll()}>
            {needle ? `Test ${shown.length} shown` : "Test all"}
          </Button>
        )}
      </div>
      <ErrorNote error={settings.listError} />
      <ErrorNote error={test.error} />
      <div className="max-h-[36rem] overflow-auto rounded-xl border">
        <table className="w-full min-w-[54rem] text-panel">
          <thead className="sticky top-0 z-10 bg-sidebar text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Model</th>
              <th className="px-3 py-2.5 font-medium">Effort</th>
              <th className="px-3 py-2.5 text-right font-medium">Latency</th>
              <th className="px-3 py-2.5 text-right font-medium">Speed</th>
              <th className="px-3 py-2.5 text-right font-medium">Tokens</th>
              <th className="px-3 py-2.5 text-right font-medium">Total</th>
              <th className="px-3 py-2.5 font-medium">Tested</th>
              <th className="px-4 py-2.5"><span className="sr-only">Run</span></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map(({ model, uses }) => {
              const result = tests[model];
              const ok = result?.status === "ok" ? result : null;
              const isRunning = running.has(model);
              const cell = (value: string | null) => (isRunning ? "…" : (value ?? "—"));
              return (
                <tr key={model} className="align-top">
                  <td className="px-4 py-3">
                    <div className="break-all font-mono">{model}</div>
                    {uses.length ? <div className="mt-0.5 text-xs text-faint">{uses.join(" · ")}</div> : null}
                    {result?.status === "error" && !isRunning ? <p className="mt-1 text-xs text-destructive">{result.error}</p> : null}
                  </td>
                  <td className="px-3 py-2">
                    <NativeSelect
                      aria-label={`Reasoning effort for ${model}`}
                      size="sm"
                      className="min-w-24"
                      value={effortFor(model)}
                      disabled={isRunning}
                      onChange={(event) => setEfforts((current) => ({ ...current, [model]: event.target.value as ReasoningEffort }))}
                    >
                      {EFFORTS.map((option) => <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>)}
                    </NativeSelect>
                    {ok && !isRunning ? <div className="mt-1 text-xs whitespace-nowrap text-faint">{effortLabel(ok.effort)}</div> : null}
                  </td>
                  <td className="px-3 py-3 text-right font-mono whitespace-nowrap">{cell(ok?.latencyMs != null ? ms(ok.latencyMs) : null)}</td>
                  <td className="px-3 py-3 text-right font-mono whitespace-nowrap">{cell(ok?.tokensPerSecond != null ? `${ok.tokensPerSecond.toFixed(1)} tok/s` : null)}</td>
                  <td className="px-3 py-3 text-right font-mono whitespace-nowrap">{cell(ok?.tokensOut != null ? `${ok.estimated ? "~" : ""}${ok.tokensOut}` : null)}</td>
                  <td className="px-3 py-3 text-right font-mono whitespace-nowrap">{cell(ok?.totalMs != null ? ms(ok.totalMs) : null)}</td>
                  <td className="px-3 py-3 text-xs whitespace-nowrap text-faint">
                    {result ? <>{testedAt(result.testedAt)}<div>{result.runs} {result.runs === 1 ? "run" : "runs"}</div></> : "Never"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button type="button" size="sm" variant="outline" disabled={isRunning} onClick={() => void run(model)}>
                      {isRunning ? "Testing…" : result ? "Again" : "Test"}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-faint">
        Latency is the wait from sending the request to the first token (a model that thinks first counts its thinking). Speed is output tokens per second after that first token, thinking included. Effort is the reasoning effort the test runs at (it starts at the effort picked under Intelligence, Medium when none is); Nemotron 3 runs with thinking off, so its effort changes nothing. Test all runs {PARALLEL_RUNS} models at a time, so models on the same provider can slow each other a little. Some listed models (embeddings, images) can&apos;t chat and will fail. Numbers vary run to run with provider load; each run is a real call and shows under AI costs. A ~ marks a token count estimated from the text because the provider sent none.
      </p>
    </div>
  );
}
