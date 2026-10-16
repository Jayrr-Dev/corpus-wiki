"use client";
import { useState } from "react";
import Link from "next/link";
import { Library } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useServerAction } from "@/components/actions/useServerAction";
import { startProgress } from "@/components/toast";
import { Tooltip } from "@/components/standard/tooltip";
import type { CuratorRunResult } from "@/lib/curator/runCurator";
import type { ActionResult } from "@/lib/server-actions/result";

// CURATE PAGES: runs the Curator over the whole page tree, with progress as it goes
async function streamCurator(): Promise<ActionResult<CuratorRunResult>> {
  const progress = startProgress("Curating pages", "Connecting to the Curator…");
  try {
    const response = await fetch("/api/curator/run", { method: "POST" });
    if (!response.ok || !response.body) throw new Error(response.status === 401 ? "Sign in before curating pages." : "Could not start the Curator.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: ActionResult<CuratorRunResult> | undefined;
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
    if (!result) throw new Error("The Curator's connection ended before a result arrived. Check Exceptions and Changes before retrying.");
    return result;
  } finally { progress.done(); }
}

export function CuratePagesButton() {
  const curate = useServerAction(streamCurator, { progress: false });
  const [result, setResult] = useState<CuratorRunResult | null>(null);
  const [open, setOpen] = useState(false);
  return <>
    <Tooltip content={curate.isPending ? "Curating…" : "Curate pages"} side="right">
      <button type="button" aria-label="Curate pages" disabled={curate.isPending} onClick={async () => {
        setResult(null);
        const response = await curate.run();
        if (response.ok) setResult(response);
        setOpen(true);
      }} className="flex size-6 shrink-0 items-center justify-center text-faint hover:text-foreground disabled:opacity-50">
        <Library className="size-3.5" />
      </button>
    </Tooltip>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogTitle>Curator</DialogTitle>
        {curate.error && <p role="alert" className="text-panel text-destructive">{curate.error}</p>}
        {result && <div className="space-y-3 text-panel">
          <p className="leading-relaxed">{result.summary}</p>
          <p className="text-muted-foreground">
            {result.proposed} change(s) proposed: {result.applied} applied, {result.exceptions} waiting for you.
            {" "}Pages {result.before.pages} → {result.after.pages}, duplicates {result.before.duplicatePairs} → {result.after.duplicatePairs}, stubs {result.before.stubs} → {result.after.stubs}.
            {result.dispatches.length ? ` ${result.dispatches.length} page(s) handed to other roles; they work in the background.` : ""}
          </p>
          <Link className="text-link hover:underline" href={result.exceptions ? "/exceptions" : "/changes"}>{result.exceptions ? "Review in Exceptions" : "View in Changes"}</Link>
        </div>}
      </DialogContent>
    </Dialog>
  </>;
}
