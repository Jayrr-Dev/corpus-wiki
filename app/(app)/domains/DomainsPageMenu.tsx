"use client";
import { useState } from "react";
import Link from "next/link";
import { RowMenu } from "@/components/row-menu/RowMenu";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useServerAction } from "@/components/actions/useServerAction";
import { startProgress } from "@/components/toast";
import { ReviewSummary } from "@/components/standard/ReviewSummary";
import type { ActionResult } from "@/lib/server-actions/result";

type ReviewResult = { reason: string; changeSetId: string; exceptions: number };
async function streamReview(): Promise<ActionResult<ReviewResult>> {
  const progress = startProgress("Reviewing domain structure", "Connecting to the review…");
  try {
    const response = await fetch("/api/domains/review", { method: "POST" });
    if (!response.ok || !response.body) throw new Error(response.status === 401 ? "Sign in before reviewing domains." : "Could not start the domain review.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: ActionResult<ReviewResult> | undefined;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        if (done && buffer) lines.push(buffer);
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line);
          if (event.type === "progress") progress.update(event.detail);
          if (event.type === "result") result = event.result;
        }
        if (done) break;
      }
    } finally { reader.releaseLock(); }
    if (!result) throw new Error("The review connection ended before a result arrived. Check Decisions before retrying.");
    return result;
  } finally { progress.done(); }
}

export function DomainsPageMenu({ showRetired }: { showRetired: boolean }) {
  const review = useServerAction(streamReview, { progress: false });
  const [result, setResult] = useState<{ reason: string; changeSetId: string; exceptions: number } | null>(null);
  const [showResult, setShowResult] = useState(false);
  return <>
    <RowMenu label="Domains" items={[
      { label: review.isPending ? "Reviewing…" : "Review structure", isDisabled: review.isPending, run: async () => {
        setResult(null);
        const response = await review.run();
        if (response.ok) setResult(response);
        setShowResult(true);
      } },
      { label: showRetired ? "Hide retired" : "Show retired", href: showRetired ? "/domains" : "/domains?retired=1" },
    ]} />
    <Dialog open={showResult} onOpenChange={setShowResult}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogTitle>Domain structure review</DialogTitle>
        {review.error && <p role="alert" className="text-panel text-destructive">{review.error}</p>}
        {result && <div className="space-y-4"><ReviewSummary text={result.reason} /><Link className="text-link hover:underline" href={result.exceptions ? "/exceptions" : `/decisions/${result.changeSetId}`}>{result.exceptions ? "Review exception" : "View decision"}</Link></div>}
      </DialogContent>
    </Dialog>
  </>;
}
