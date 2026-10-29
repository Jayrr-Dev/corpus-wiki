import { formatCount } from "@/app/(app)/_lib/format";

// What the bottom toast says while suggestions are found or applied.
// A merge places claims on an article that already exists. A new article is written from scratch.

export type SuggestionSnapshot = {
  id: string;
  kind: "merge" | "create";
  status: string;
  title: string;
  note: string | null;
  writing: boolean;
};

export type RunSnapshot = {
  state: string;
  phase: string | null;
  done: number;
  total: number;
  suggested: number;
  error: string | null;
};

export type SuggestionToast = {
  title: string;
  detail: string;
  fraction?: number;
  done: boolean;
};

const LEAVE = "You can leave this page.";

function working(item: SuggestionSnapshot) {
  return item.status === "accepting" || item.writing;
}

function missingKey(item: SuggestionSnapshot) {
  return /API_KEY is not set/i.test(item.note ?? "");
}

function statusLine(item: SuggestionSnapshot, mergesLeft: boolean) {
  if (missingKey(item)) return "Paused. The AI key is missing.";
  if (mergesLeft) return "Merges go first.";
  if (item.writing || item.kind === "create") return "Writing a new article.";
  return "Placing a merge.";
}

function applyToast(items: SuggestionSnapshot[], batch: ReadonlySet<string>): SuggestionToast | null {
  const tracked = items.filter((item) => batch.has(item.id));
  const still = tracked.filter(working);
  const failed = tracked.filter((item) => item.status === "failed" || item.status === "stale");
  const placed = tracked.filter((item) => item.status === "applied" && !item.writing);
  const total = batch.size;
  const doneCount = placed.length + failed.length + tracked.filter((item) => item.status === "dismissed").length;
  if (!total) return null;
  if (!still.length && doneCount < total) {
    return {
      title: "Applying suggestions",
      detail: `Still working. ${LEAVE}`,
      fraction: doneCount / total,
      done: false,
    };
  }
  if (!still.length && doneCount >= total) {
    const detail = failed.length
      ? `${formatCount(placed.length)} applied. ${formatCount(failed.length)} need a retry.`
      : total === 1
        ? "That suggestion is in."
        : `All ${formatCount(total)} are in.`;
    return { title: "Applying suggestions", detail, fraction: 1, done: true };
  }
  const mergesLeft = still.some((item) => item.kind === "merge");
  const current = still.find((item) => missingKey(item))
    ?? still.find((item) => item.kind === "merge")
    ?? still[0];
  const lead = total > 1 ? `${formatCount(doneCount)} of ${formatCount(total)} done.` : "";
  const detail = [lead, current ? statusLine(current, mergesLeft && total > 1) : "", LEAVE].filter(Boolean).join("\n");
  return {
    title: "Applying suggestions",
    detail,
    fraction: total ? doneCount / total : undefined,
    done: false,
  };
}

function runToast(run: RunSnapshot, watching: boolean): SuggestionToast | null {
  const active = run.state === "queued" || run.state === "running";
  if (!active && !watching) return null;
  if (run.state === "failed") {
    return { title: "Finding suggestions", detail: "The run stopped. Open Suggestions to see why.", fraction: 1, done: true };
  }
  if (!active) {
    const found = run.suggested
      ? `Found ${formatCount(run.suggested)} suggestions.`
      : "The run finished.";
    return { title: "Finding suggestions", detail: found, fraction: 1, done: true };
  }
  if (run.state === "queued" || run.phase === "grouping" || !run.total) {
    return { title: "Finding suggestions", detail: `Grouping related knowledge. ${LEAVE}`, done: false };
  }
  return {
    title: "Finding suggestions",
    detail: `${formatCount(run.done)} of ${formatCount(run.total)} groups done. Suggestions show up as each one finishes. ${LEAVE}`,
    fraction: run.done / run.total,
    done: false,
  };
}

// Apply work wins over a run. The batch remembers every suggestion that started, so the bar does not shrink when one finishes.
export function nextSuggestionToast(
  items: SuggestionSnapshot[],
  batch: ReadonlySet<string>,
  run: RunSnapshot | null,
  watchingRun: boolean,
): { batch: Set<string>; watchingRun: boolean; toast: SuggestionToast | null } {
  const nextBatch = new Set(batch);
  for (const item of items) if (working(item)) nextBatch.add(item.id);
  const apply = applyToast(items, nextBatch);
  if (apply) {
    return { batch: apply.done ? new Set() : nextBatch, watchingRun, toast: apply };
  }
  if (!run) return { batch: nextBatch, watchingRun: false, toast: null };
  const toast = runToast(run, watchingRun);
  const active = run.state === "queued" || run.state === "running";
  return { batch: nextBatch, watchingRun: active, toast };
}

export function suggestionWriting(status: string, signals: unknown) {
  if (status !== "applied" || !signals || typeof signals !== "object" || Array.isArray(signals)) return false;
  return Boolean((signals as { writing?: boolean }).writing);
}
