"use client";

import { useState } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { LinkIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { linkBatch, planLinkPass } from "@/lib/server-actions/links";

type Progress = { done: number; total: number; applied: number; failed: number };

// LINK EXISTING CLAIMS (graph, top-right): asks the model to link the claims already in
// the store, a batch at a time. Each batch is one AI ChangeSet (undo it on Changes);
// the graph refreshes after every batch, so new links appear as it goes.
export function LinkExistingButton() {
  const plan = useServerAction(planLinkPass);
  const link = useServerAction(linkBatch);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const isRunning = progress !== null && progress.done < progress.total;

  const run = async () => {
    setBatchError(null);
    const planned = await plan.run();
    if (!planned.ok) return;
    let current: Progress = { done: 0, total: planned.batches.length, applied: 0, failed: 0 };
    setProgress(current);
    for (const batch of planned.batches) {
      const result = await link.run(batch);
      // A failed batch (e.g. a malformed model answer) is counted and the rest still run
      if (!result.ok) setBatchError(result.error);
      current = {
        ...current,
        done: current.done + 1,
        applied: current.applied + (result.ok ? result.applied : 0),
        failed: current.failed + (result.ok ? 0 : 1),
      };
      setProgress(current);
    }
  };

  return (
    <div className="flex max-w-64 flex-col items-end gap-1 text-right">
      <Button size="sm" variant="outline" disabled={plan.isPending || isRunning} onClick={() => void run()}>
        <LinkIcon size={14} />
        {plan.isPending ? "Planning…" : isRunning ? `Linking ${progress.done + 1} of ${progress.total}…` : "Link existing claims"}
      </Button>
      {progress && (
        <p className="font-mono text-xs text-faint">
          {progress.applied} link{progress.applied === 1 ? "" : "s"} added
          {progress.failed > 0 && ` · ${progress.failed} batch${progress.failed === 1 ? "" : "es"} failed`}
        </p>
      )}
      <ErrorNote error={plan.error ?? batchError} />
    </div>
  );
}
