"use client";

import { useState } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { LinkIcon } from "@/components/icons";
import { startProgress } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { ActionHint } from "@/components/actions/ActionHint";
import { linkBatch, planLinkPass } from "@/lib/server-actions/links";

type Progress = { done: number; total: number; applied: number; failed: number };

// LINK EXISTING CLAIMS (graph settings): asks the model to link the claims already in
// the store, a batch at a time. Each batch is one AI ChangeSet (undo it on Changes);
// the graph refreshes after every batch, so new links appear as it goes.
export function LinkExistingButton() {
  const plan = useServerAction(planLinkPass, { progress: false });
  const link = useServerAction(linkBatch, { progress: false });
  const [progress, setProgress] = useState<Progress | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const isRunning = progress !== null && progress.done < progress.total;

  const run = async () => {
    setBatchError(null);
    const toast = startProgress("Linking existing claims", "Planning…");
    const planned = await plan.run();
    if (!planned.ok) return toast.fail();
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
      toast.update(`Checked ${current.done} of ${current.total} batches`, current.done / current.total);
    }
    toast.done(current.failed > 0 ? `Finished · ${current.failed} batches failed` : undefined);
  };

  return (
    <div className="flex flex-col items-stretch gap-1">
      <Button size="sm" variant="outline" className="justify-start" disabled={plan.isPending || isRunning} onClick={() => void run()}>
        <LinkIcon size={14} />
        {plan.isPending ? "Planning…" : isRunning ? `Linking ${progress.done + 1} of ${progress.total}…` : "Link existing claims"}
        <ActionHint>Asks the AI to find links between claims already in the store, a batch at a time. Each batch is one change you can undo on Changes.</ActionHint>
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
