"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useServerAction } from "@/components/actions/useServerAction";
import { readPageReviewStatus, reviewPage } from "@/lib/server-actions/pageReview";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { REVIEW_PROGRESS_EVENT, reviewProgressChannel } from "@/lib/living-page/reviewProgress";

export function ReviewPageButton({ pageId, disabled }: { pageId: string; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [detail, setDetail] = useState("Connecting live updates…");
  const disconnect = useRef<(() => void) | null>(null);
  const running = useRef(false);
  useEffect(() => () => disconnect.current?.(), []);
  const review = useServerAction(reviewPage, { progress: { title: "Reviewing page", detail: "Checking evidence and related knowledge, then applying clear fixes…" } });
  const status = useQuery({ queryKey: ["table", "page_review_runs", pageId], queryFn: () => readPageReviewStatus(pageId), refetchInterval: open ? 5000 : false });
  const latest = status.data?.latest;
  const run = async () => {
    if (running.current) return;
    running.current = true;
    setOpen(true); setConnecting(true); setDetail("Connecting live updates…");
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
      await new Promise<void>((resolve) => {
        const timeout = window.setTimeout(resolve, 4000);
        channel.subscribe((state) => {
          if (["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT"].includes(state)) { window.clearTimeout(timeout); resolve(); }
        });
      });
      setConnecting(false); setDetail("Reading the page and its evidence…");
      await review.run(pageId, runId);
    } finally {
      cleanup(); disconnect.current = null; running.current = false; setConnecting(false);
    }
  };
  return <div className="flex items-center gap-1">
    <Button size="sm" variant="outline" disabled={disabled || review.isPending || connecting} onClick={() => void run()}>{review.isPending || connecting ? "Reviewing…" : "Review page"}</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogTitle>Page review</DialogTitle>
        <DialogDescription>Clear editorial fixes are applied automatically and can be undone in Changes. Only unresolved decisions go to Exceptions.</DialogDescription>
        {review.isPending || connecting ? <p role="status" className="line-clamp-3 break-words">{detail}</p> : null}
        {review.error || status.error ? <p role="alert">{review.error ?? status.error?.message}</p> : null}
        {latest && !review.isPending && !connecting ? <div className="space-y-3">
          <p>{latest.summary}</p>
          <p>{latest.edits} {latest.edits === 1 ? "fix applied" : "fixes applied"}. {status.data?.openExceptions ?? 0} unresolved decisions.</p>
          <div className="flex gap-4">
            {latest.change_set_id ? <Link className="text-link underline" href={`/changes/${latest.change_set_id}`}>View changes or undo</Link> : null}
            {(status.data?.openExceptions ?? 0) > 0 ? <Link className="text-link underline" href="/exceptions">Review exceptions</Link> : null}
          </div>
        </div> : null}
      </DialogContent>
    </Dialog>
  </div>;
}
