"use client";

import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CoveragePicker } from "@/components/knowledge/CoveragePicker";
import { ScopePicker } from "@/components/knowledge/ScopePicker";
import { InfoHint } from "@/components/standard/info-hint";
import { Tooltip } from "@/components/standard/tooltip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { applyOutlineEdits, type DocOutline, movePage, OUTLINE_GROUP_LABELS, type OutlineEdit } from "@/lib/docs/outline";
import type { Coverage, Scope, ScopeOptions } from "@/lib/knowledge/scopeTypes";

type Failed = { ok: false; error: string };

async function post<T>(url: string, body: unknown): Promise<T | Failed> {
  try {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return (await response.json()) as T;
  } catch {
    return { ok: false, error: "Could not reach the server." };
  }
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip content={label}>
      <Button type="button" size="icon-sm" variant="ghost" aria-label={label} disabled={disabled} onClick={onClick}>{children}</Button>
    </Tooltip>
  );
}

// NEW DOCS: pick a source and coverage, let the Docs writer propose the pages, edit them, then write
export function NewDocsDialog({ open, onOpenChange, options }: { open: boolean; onOpenChange: (open: boolean) => void; options: ScopeOptions }) {
  const router = useRouter();
  const [scope, setScope] = useState<Scope | null>(null);
  const [coverage, setCoverage] = useState<Coverage>(100);
  const [outline, setOutline] = useState<DocOutline | null>(null);
  const [edits, setEdits] = useState<OutlineEdit>([]);
  const [busy, setBusy] = useState<"planning" | "writing" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setOutline(null); setEdits([]); setError(null); };
  const close = (next: boolean) => {
    if (busy) return;
    if (!next) { reset(); setScope(null); setCoverage(100); }
    onOpenChange(next);
  };

  const propose = async () => {
    if (!scope) return;
    setBusy("planning"); setError(null);
    const result = await post<{ ok: true; outline: DocOutline }>("/api/docs/outline", { scope, coverage });
    setBusy(null);
    if (!result.ok) { setError(result.error); return; }
    const proposed = result.outline;
    setOutline(proposed);
    setEdits(proposed.pages.map((page, index) => ({ index, title: page.title })));
  };

  const write = async () => {
    if (!scope || !outline) return;
    setBusy("writing"); setError(null);
    const result = await post<{ ok: true; id: string }>("/api/docs", { scope, coverage, outline: applyOutlineEdits(outline, edits) });
    setBusy(null);
    if (!result.ok) { setError(result.error); return; }
    close(false);
    router.push(`/docs/${result.id}`);
  };

  const rename = (at: number, title: string) => setEdits((current) => current.map((edit, index) => (index === at ? { ...edit, title } : edit)));

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New docs</DialogTitle>
          <DialogDescription>Step-by-step docs from your knowledge. Check the pages before they are written.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          <div className="grid gap-2">
            <h3 className="font-medium">Source</h3>
            <ScopePicker options={options} value={scope} disabled={busy !== null} onChange={(next) => { setScope(next); reset(); }} />
          </div>
          <div className="grid gap-2">
            <h3 className="font-medium">Coverage</h3>
            <CoveragePicker value={coverage} disabled={busy !== null} onChange={(next) => { setCoverage(next); reset(); }} />
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                <h3 className="font-medium">Outline</h3>
                <InfoHint>Pages are grouped by task: set up, use, change, remove.</InfoHint>
              </div>
              {outline ? <Button type="button" size="sm" variant="ghost" disabled={!scope || busy !== null} onClick={propose}>Propose again</Button> : null}
            </div>
            {outline ? (
              edits.length ? (
                <ol className="grid gap-2">
                  {edits.map((edit, at) => {
                    const page = outline.pages[edit.index]!;
                    return (
                      <li key={edit.index} className="flex items-center gap-2">
                        <Input aria-label={`Page ${at + 1} title`} value={edit.title} disabled={busy !== null} onChange={(event) => rename(at, event.target.value)} />
                        <span className="w-14 shrink-0 text-xs text-muted-foreground">{OUTLINE_GROUP_LABELS[page.group]}</span>
                        <IconButton label="Move up" disabled={at === 0 || busy !== null} onClick={() => setEdits((current) => movePage(current, at, -1))}><ArrowUp /></IconButton>
                        <IconButton label="Move down" disabled={at === edits.length - 1 || busy !== null} onClick={() => setEdits((current) => movePage(current, at, 1))}><ArrowDown /></IconButton>
                        <IconButton label="Drop page" disabled={busy !== null} onClick={() => setEdits((current) => current.filter((_, index) => index !== at))}><X /></IconButton>
                      </li>
                    );
                  })}
                </ol>
              ) : <p className="text-panel text-muted-foreground">No pages left.</p>
            ) : (
              <div>
                <Button type="button" size="sm" variant="outline" disabled={!scope || busy !== null} onClick={propose}>
                  {busy === "planning" ? "Planning pages…" : "Propose pages"}
                </Button>
              </div>
            )}
          </div>
          {error ? <p role="alert" className="text-panel text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy !== null} onClick={() => close(false)}>Cancel</Button>
          <Button type="button" disabled={!outline || !edits.length || busy !== null} onClick={write}>
            {busy === "writing" ? `Writing ${edits.length} page${edits.length === 1 ? "" : "s"}…` : "Write docs"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
