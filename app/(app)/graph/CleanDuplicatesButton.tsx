"use client";

import { useState } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { Button } from "@/components/ui/button";
import { dedupeBatch, planDedupePass } from "@/lib/server-actions/dedupe";

type Progress = { done: number; total: number; proposed: number; failed: number };

// CLEAN DUPLICATES (graph, top-right): the cleaning cycle. Finds claims that look alike, asks
// the model which are the same claim, and proposes merging them. Merges wait for a person on
// the Exceptions screen; a wording update that merges details may be applied straight away.
export function CleanDuplicatesButton() {
  const plan = useServerAction(planDedupePass);
  const dedupe = useServerAction(dedupeBatch);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const isRunning = progress !== null && progress.done < progress.total;

  const run = async () => {
    setBatchError(null);
    const planned = await plan.run();
    if (!planned.ok) return;
    let current: Progress = { done: 0, total: planned.clusters.length, proposed: 0, failed: 0 };
    setProgress(current);
    for (const cluster of planned.clusters) {
      const result = await dedupe.run(cluster);
      // A failed cluster (e.g. a malformed model answer) is counted and the rest still run
      if (!result.ok) setBatchError(result.error);
      current = {
        ...current,
        done: current.done + 1,
        proposed: current.proposed + (result.ok ? result.proposed : 0),
        failed: current.failed + (result.ok ? 0 : 1),
      };
      setProgress(current);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1 text-right">
      <Button size="sm" variant="outline" disabled={plan.isPending || isRunning} onClick={() => void run()}>
        {plan.isPending ? "Looking…" : isRunning ? `Checking ${progress.done + 1} of ${progress.total}…` : "Clean duplicates"}
      </Button>
      {progress && (
        <p className="font-mono text-xs text-faint">
          {progress.total === 0
            ? "No look-alike claims"
            : `${progress.proposed} merge${progress.proposed === 1 ? "" : "s"} sent to Exceptions`}
          {progress.failed > 0 && ` · ${progress.failed} failed`}
        </p>
      )}
      <ErrorNote error={plan.error ?? batchError} />
    </div>
  );
}
