"use client";

import { useState } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { startProgress } from "@/components/toast";
import { DuplicateIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ActionHint } from "@/components/actions/ActionHint";
import { dedupeBatch, planDedupePass } from "@/lib/server-actions/dedupe";

type Progress = { done: number; total: number; proposed: number; applied: number; exceptions: number; removed: number; failed: number };

// Explicit cleanup merges matching claims directly and refreshes cached graph data.
export function CleanDuplicatesButton() {
  const plan = useServerAction(planDedupePass, { progress: false });
  const dedupe = useServerAction(dedupeBatch, { progress: false });
  const [progress, setProgress] = useState<Progress | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const isRunning = progress !== null && progress.done < progress.total;

  const run = async () => {
    setBatchError(null);
    const toast = startProgress("Cleaning duplicates", "Planning…");
    const planned = await plan.run();
    if (!planned.ok) return toast.fail();
    let current: Progress = { done: 0, total: planned.clusters.length, proposed: 0, applied: 0, exceptions: 0, removed: 0, failed: 0 };
    setProgress(current);
    for (const cluster of planned.clusters) {
      const result = await dedupe.run(cluster);
      // A failed cluster (e.g. a malformed model answer) is counted and the rest still run
      if (!result.ok) setBatchError(result.error);
      current = {
        ...current,
        done: current.done + 1,
        proposed: current.proposed + (result.ok ? result.proposed : 0),
        applied: current.applied + (result.ok ? result.applied : 0),
        exceptions: current.exceptions + (result.ok ? result.exceptions : 0),
        removed: current.removed + (result.ok ? result.removed : 0),
        failed: current.failed + (result.ok ? 0 : 1),
      };
      setProgress(current);
      toast.update(`Checked ${current.done} of ${current.total} groups`, current.done / current.total);
    }
    toast.done(current.failed > 0 ? `Finished · ${current.failed} groups failed` : undefined);
  };

  return (
    <div className="flex flex-col items-stretch gap-1">
      <Button size="sm" variant="outline" className="justify-start" disabled={plan.isPending || isRunning} onClick={() => void run()}>
        <DuplicateIcon size={14} />
        {plan.isPending ? "Looking…" : isRunning ? `Checking ${progress.done + 1} of ${progress.total}…` : "Clean duplicates"}
        <ActionHint>Finds claims that say the same thing and merges them into one, keeping their links and sources.</ActionHint>
      </Button>
      {progress && !isRunning && (
        <div role="status" className="text-xs text-muted-foreground">
          <p>{progress.total === 0
            ? "No candidate duplicates found."
            : progress.proposed === 0
              ? "No confirmed duplicates found in checked groups."
              : `${progress.removed} duplicate${progress.removed === 1 ? "" : "s"} merged.`}
            {progress.failed > 0 && ` ${progress.failed} groups failed; cleanup is incomplete.`}
          </p>
        </div>
      )}
      <ErrorNote error={plan.error ?? batchError} />
    </div>
  );
}


