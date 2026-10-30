"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { GraphCanvas } from "@/components/graph/GraphCanvas";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DEFAULT_GRAPH_SETTINGS } from "@/lib/graph";
import { withDomainColorGroups } from "@/lib/graph/settings";
import { publicGraphData } from "@/lib/publishing/publicGraph";
import type { PublicGraph } from "@/lib/publishing/types";

// The link is the same for every reader, so it always opens the graph on its own
export function PublicGraphDialog({ graph, title, base, closeHref, publishedAt }: {
  graph: PublicGraph; title: string; base: string; closeHref: string; publishedAt: string;
}) {
  const router = useRouter();
  const [copyLabel, setCopyLabel] = useState("Copy link");
  const data = useMemo(() => publicGraphData(graph, base, publishedAt), [graph, base, publishedAt]);
  const settings = useMemo(() => {
    const seeded = withDomainColorGroups(DEFAULT_GRAPH_SETTINGS, data.nodes);
    return { ...seeded, display: { ...seeded.display, showNew: false } };
  }, [data]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${base}/graph`);
      setCopyLabel("Copied");
    } catch {
      // Blocked clipboards still leave the link in the address bar
      setCopyLabel("Use address bar");
    }
  }

  return <Dialog open onOpenChange={next => { if (!next) router.push(closeHref); }}>
    <DialogContent fullScreen showCloseButton={false}>
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <DialogTitle><span className="block truncate">{title}</span></DialogTitle>
          <DialogDescription className="sr-only">A map of this wiki’s published pages and the claims behind them.</DialogDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" onClick={copyLink}>{copyLabel}</Button>
          <Button type="button" variant="ghost" onClick={() => router.push(closeHref)}>Close</Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
        <GraphCanvas graph={data} settings={settings} hint="Scroll to zoom · Click a dot twice to open its article" onOpen={node => router.push(node.href)} />
      </div>
    </DialogContent>
  </Dialog>;
}
