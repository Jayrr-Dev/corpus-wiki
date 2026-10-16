"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { EmptyState } from "@/components/EmptyState";
import { SourceIcon } from "@/components/icons";
import { QueryState } from "@/app/(app)/_components/bits";
import { asObject, readString } from "@/app/(app)/_lib/format";
import { DateTime } from "@/app/(app)/_components/DateTime";
import { useTableList } from "@/lib/queries";
import { useRealtimeInvalidation } from "@/lib/realtime";

export function ExternalReviewHistory() {
  const [open, setOpen] = useState(false);
  const reviews = useTableList("external_source_reviews", { orderBy: "created_at", ascending: false, limit: 50 }, open);
  useRealtimeInvalidation("external_source_reviews", { enabled: open });
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button variant="outline" size="sm">Research decisions</Button></DialogTrigger>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>External research decisions</DialogTitle>
        <DialogDescription>The researcher must justify a project-specific gap and each proposed source. An independent AI approver makes the final decision using project evidence, without the researcher’s instructions. Saved sources are only changed when you run a review.</DialogDescription>
      </DialogHeader>
      <QueryState query={reviews}>
        {!reviews.data?.length ? <EmptyState icon={SourceIcon} title="No review decisions yet" hint="New external searches and proposed sources will be reviewed here." /> : <div className="space-y-4">
          {reviews.data.map((review) => {
            const context = asObject(review.context);
            const proposal = asObject(review.proposal);
            const research = asObject(proposal?.research);
            const justification = readString(proposal, "justification") ?? readString(research, "justification");
            const gap = readString(proposal, "gap") ?? readString(research, "gap");
            return <article key={review.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{review.stage === "search" ? "Search request" : "Source request"} · {review.reverted_at ? "Reversed" : review.outcome === "error" ? "Blocked: review failed" : review.outcome === "approved" ? "Approved" : "Rejected"}</span>
                <span><DateTime iso={review.created_at} /></span>
              </div>
              <h3 className="font-medium">{review.source_title ?? readString(context, "article")}</h3>
              <p className="text-panel text-muted-foreground">{[readString(context, "organization"), readString(context, "article"), readString(context, "section")].filter(Boolean).join(" → ")}</p>
              {review.url && <a href={review.url} target="_blank" rel="noreferrer" className="block truncate text-panel text-link underline-offset-2 hover:underline">{review.url}</a>}
              {gap && <p className="text-panel"><span className="font-medium">Information gap: </span>{gap}</p>}
              {justification && <p className="text-panel"><span className="font-medium">Researcher’s justification: </span>{justification}</p>}
              <p className="text-panel"><span className="font-medium">Approver’s decision: </span>{review.reason}</p>
              {review.excerpts.length > 0 && <details className="text-panel"><summary className="cursor-pointer text-muted-foreground">Review evidence ({review.excerpts.length} excerpts)</summary><div className="mt-2 space-y-2">{review.excerpts.map((text, index) => <blockquote key={index} className="border-l-2 pl-3 whitespace-pre-wrap">{text}</blockquote>)}</div></details>}
            </article>;
          })}
        </div>}
      </QueryState>
    </DialogContent>
  </Dialog>;
}
