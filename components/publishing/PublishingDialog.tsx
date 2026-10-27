"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { describeCallError } from "@/lib/server-actions/result";
import { loadPublishingDialog } from "@/lib/server-actions/publishing";
import type { PublicationEditor, WikiMetrics } from "@/lib/publishing/types";
import { PublishingPanel } from "./PublishingPanel";

function editionKey(editor: PublicationEditor) {
  const publishedAt = editor.publication?.publishedAt ?? "";
  const visibility = editor.publication?.visibility ?? "";
  return `${editor.spaceId}:${publishedAt}:${visibility}:${editor.pages.map((page) => page.fingerprint).join("")}`;
}

export function PublishingDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [data, setData] = useState<{ editor: PublicationEditor; metrics: WikiMetrics } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    loadPublishingDialog()
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setData({ editor: result.editor, metrics: result.metrics });
          setError(null);
        } else setError(result.error);
      })
      .catch((caught) => {
        if (!cancelled) setError(describeCallError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [open, tick]);

  function close(next: boolean) {
    if (!next) {
      setData(null);
      setError(null);
      setTick(0);
    }
    onOpenChange(next);
  }

  let showLoading = false;
  if (open) {
    if (data === null) showLoading = error === null;
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Publishing</DialogTitle>
          <DialogDescription className="sr-only">Choose who can read this space, which pages are shared, and how readers find it.</DialogDescription>
        </DialogHeader>
        {showLoading ? <p className="text-muted-foreground">Loading publishing…</p> : null}
        {error ? (
          <div className="space-y-3">
            <p role="alert" className="text-destructive">{error}</p>
            <Button type="button" variant="outline" onClick={() => { setError(null); setTick((value) => value + 1); }}>Try again</Button>
          </div>
        ) : null}
        {data ? (
          <PublishingPanel key={editionKey(data.editor)} editor={data.editor} initialMetrics={data.metrics} onRefresh={() => { setError(null); setTick((value) => value + 1); }} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
