"use client";

import { useState } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { EntityIcon } from "@/components/icons";
import { startProgress } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { ActionHint } from "@/components/actions/ActionHint";
import { useUndescribedEntityCount } from "@/lib/queries/screens";
import { describeBatch, planDescribePass } from "@/lib/server-actions/entities";

type Progress = { done: number; total: number; described: number; skipped: number; failed: number };

// DESCRIBE ENTITIES (graph actions): writes a short AI description for every entity
// still without one, from the claims that mention it. Uploads describe the entities
// they create, so this backfills the older ones (and any whose upload call failed).
export function DescribeEntitiesButton() {
  const plan = useServerAction(planDescribePass, { progress: false });
  const describe = useServerAction(describeBatch, { progress: false });
  const [progress, setProgress] = useState<Progress | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const undescribed = useUndescribedEntityCount();
  const isRunning = progress !== null && progress.done < progress.total;

  const run = async () => {
    setBatchError(null);
    const toast = startProgress("Describing entities", "Planning…");
    const planned = await plan.run();
    if (!planned.ok) return toast.fail();
    let current: Progress = { done: 0, total: planned.batches.length, described: 0, skipped: 0, failed: 0 };
    setProgress(current);
    for (const batch of planned.batches) {
      const result = await describe.run(batch);
      // A failed batch (e.g. a malformed model answer) is counted and the rest still run
      if (!result.ok) setBatchError(result.error);
      current = {
        ...current,
        done: current.done + 1,
        described: current.described + (result.ok ? result.described : 0),
        skipped: current.skipped + (result.ok ? result.skipped : 0),
        failed: current.failed + (result.ok ? 0 : 1),
      };
      setProgress(current);
      toast.update(`Described ${current.done} of ${current.total} batches`, current.done / current.total);
    }
    toast.done(describeSummary(current));
  };

  // Only offered while some entity still lacks a description (kept up through a run so its progress shows)
  if (!undescribed.data && !plan.isPending && !isRunning) return null;

  return (
    <div className="flex flex-col items-stretch gap-1">
      <Button size="sm" variant="outline" className="justify-start" disabled={plan.isPending || isRunning} onClick={() => void run()}>
        <EntityIcon size={14} />
        {plan.isPending ? "Planning…" : isRunning ? `Describing ${progress.done + 1} of ${progress.total}…` : "Describe entities"}
        <ActionHint>Writes a short AI description for every entity that has none yet, from the claims that mention it.</ActionHint>
      </Button>
      <ErrorNote error={plan.error ?? batchError} />
    </div>
  );
}

// RESULT LINE for the done toast: what was described, left without, or failed
function describeSummary(progress: Progress): string {
  if (progress.total === 0) return "Every entity has a description.";
  const parts = [`${progress.described} entit${progress.described === 1 ? "y" : "ies"} described`];
  if (progress.skipped > 0) parts.push(`${progress.skipped} left without (nothing to go on)`);
  if (progress.failed > 0) parts.push(`${progress.failed} batch${progress.failed === 1 ? "" : "es"} failed`);
  return parts.join(" · ");
}
