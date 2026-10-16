"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toDateInputValue } from "@/app/(app)/_lib/format";
import { UploadStatus } from "./UploadItem";
import { retryTarget, useUploadFlow } from "./useUploadFlow";

// ADD LINK FORM: a public page URL and its date; AI reads the page and adds it as an uploaded source
export function AddLink({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [sourceDate, setSourceDate] = useState(() => toDateInputValue(Date.now()));
  const { phase, startLink, retry } = useUploadFlow();
  const busy = phase.kind === "starting" || phase.kind === "processing";
  return (
    <form id="add-link-form" className="flex flex-col gap-3 rounded-lg border p-4" onSubmit={(event) => { event.preventDefault(); if (!busy) void startLink(url, sourceDate); }}>
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">Add a link</p>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
      <p className="text-panel text-muted-foreground">Paste a public page link. AI will extract its information and add it as an uploaded source. Pages requiring sign-in may not be readable.</p>
      <label htmlFor="upload-link" className="text-xs text-faint">Page URL</label>
      <Input id="upload-link" type="url" placeholder="https://example.com/article" required value={url} disabled={busy} onChange={(event) => setUrl(event.target.value)} />
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="link-source-date" className="text-xs text-faint">Source date</label>
        <Input id="link-source-date" type="date" required value={sourceDate} disabled={busy} onChange={(event) => setSourceDate(event.target.value)} className="w-40" />
        <Button size="sm" type="submit" disabled={busy || !url.trim() || !sourceDate}>{busy ? "Reading link…" : "Extract information"}</Button>
      </div>
      <div aria-live="polite">
        {phase.kind === "starting" ? <p className="text-xs text-faint">Opening the page and reading its text…</p> : <UploadStatus phase={phase} />}
      </div>
      {retryTarget(phase) ? <div><Button type="button" size="sm" variant="outline" onClick={() => void retry()}>Retry extraction</Button></div> : null}
    </form>
  );
}
