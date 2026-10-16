"use client";

import { useEffect, useState } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { startProgress } from "@/components/toast";
import { useUndescribedEntityCount } from "@/lib/queries/screens";
import { describeBatch, planDescribePass } from "@/lib/server-actions/entities";

type Progress = { done: number; total: number; described: number; skipped: number; failed: number };

// Entities already sent this browser session, so one the model leaves without a
// description (or a failed batch) is not retried on every visit to the graph
const attempted = new Set<string>();
let running = false;

// AUTO DESCRIBE ENTITIES (/graph actions, /entities): whenever either opens with entities still
// without a description, writes a short AI description for each from the claims that
// mention it. Uploads describe the entities they create, so this backfills the older
// ones (and any whose upload call failed). Renders only a failed batch's error.
export function AutoDescribeEntities() {
  const plan = useServerAction(planDescribePass, { progress: false });
  const describe = useServerAction(describeBatch, { progress: false });
  const [batchError, setBatchError] = useState<string | null>(null);
  const undescribed = useUndescribedEntityCount();

  useEffect(() => {
    if (!undescribed.data || running) return;
    running = true;
    void (async () => {
      try {
        const planned = await plan.run();
        if (!planned.ok) return;
        const batches = planned.batches.map((batch) => batch.filter((id) => !attempted.has(id))).filter((batch) => batch.length > 0);
        if (batches.length === 0) return;
        const toast = startProgress("Describing entities", "Planning…");
        let current: Progress = { done: 0, total: batches.length, described: 0, skipped: 0, failed: 0 };
        for (const batch of batches) {
          for (const id of batch) attempted.add(id);
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
          toast.update(`Described ${current.done} of ${current.total} batches`, current.done / current.total);
        }
        toast.done(describeSummary(current));
      } finally {
        running = false;
      }
    })();
    // Runs when the count says there is work; plan/describe are fresh closures each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undescribed.data]);

  return <ErrorNote error={plan.error ?? batchError} />;
}

// RESULT LINE for the done toast: what was described, left without, or failed
function describeSummary(progress: Progress): string {
  const parts = [`${progress.described} entit${progress.described === 1 ? "y" : "ies"} described`];
  if (progress.skipped > 0) parts.push(`${progress.skipped} left without (nothing to go on)`);
  if (progress.failed > 0) parts.push(`${progress.failed} batch${progress.failed === 1 ? "" : "es"} failed`);
  return parts.join(" · ");
}
