"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useServerAction } from "@/components/actions/useServerAction";
import { reviewPage } from "@/lib/server-actions/pageReview";
import type { PageReviewResult } from "@/lib/living-page/runPageReview";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { REVIEW_PROGRESS_EVENT, reviewProgressChannel } from "@/lib/living-page/reviewProgress";

export function ReviewPageButton({ pageId, disabled }: { pageId: string; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<PageReviewResult | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [detail, setDetail] = useState("Connecting live updates…");
  const disconnect = useRef<(() => void) | null>(null);
  const running = useRef(false);
  useEffect(() => () => disconnect.current?.(), []);
  const review = useServerAction(reviewPage, { progress: { title: "Reviewing page", detail: "Checking evidence and related knowledge, then applying clear fixes…" } });
  const run = async () => {
    if (running.current) return;
    running.current = true;
    setOpen(false); setResult(null); setConnecting(true); setDetail("Connecting live updates…");
    const client = getBrowserSupabase();
    const runId = crypto.randomUUID();
    let seq = 0;
    let listening = true;
    const channel = client.channel(reviewProgressChannel(runId)).on("broadcast", { event: REVIEW_PROGRESS_EVENT }, ({ payload }) => {
      if (!listening || typeof payload?.detail !== "string" || typeof payload.seq !== "number" || payload.seq <= seq) return;
      seq = payload.seq;
      setDetail(payload.detail);
      review.updateProgress(payload.detail);
    });
    const cleanup = () => { listening = false; void client.removeChannel(channel); };
    disconnect.current = cleanup;
    try {
      // Progress is best effort; the review must not wait for a subscription.
      channel.subscribe();
      setConnecting(false); setDetail("Reading the page and its evidence…");
      const outcome = await review.run(pageId, runId);
      if (outcome.ok) setResult(outcome);
      setOpen(true);
    } finally {
      cleanup(); disconnect.current = null; running.current = false; setConnecting(false);
    }
  };
  return <div className="flex items-center gap-1">
    <Button size="sm" variant="outline" disabled={disabled || review.isPending || connecting} onClick={() => void run()}>{review.isPending || connecting ? "Reviewing…" : "Review page"}</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent aria-describedby={undefined} className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
        <DialogTitle>{result ? "Page review complete" : "Page review"}</DialogTitle>
        {review.isPending || connecting ? <p role="status" className="line-clamp-3 break-words">{detail}</p> : null}
        {review.error ? <p role="alert">{review.error}</p> : null}
        {result && !review.isPending && !connecting ? <div className="space-y-3">
          <p className="whitespace-pre-wrap break-words">{result.summary}</p>
          <p>{result.edits} {result.edits === 1 ? "fix applied" : "fixes applied"}. {result.exceptions} unresolved decisions.</p>
          <div className="flex gap-4">
            {result.changeSetId ? <Link className="text-link underline" href={`/changes/${result.changeSetId}`}>View changes or undo</Link> : null}
            {result.exceptions > 0 ? <Link className="text-link underline" href="/exceptions">Review exceptions</Link> : null}
          </div>
        </div> : null}
      </DialogContent>
    </Dialog>
  </div>;
}
