"use client";

import { useRouter } from "next/navigation";
import { useServerAction } from "@/components/actions/useServerAction";
import { InfoHint } from "@/components/standard/info-hint";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { docSetsToRetire, planDocCleanup } from "@/lib/docs/clean";
import type { DocSetSummary } from "@/lib/docs/types";
import { cleanDocSets } from "./actions";

const pages = (set: DocSetSummary) => `${set.pageCount} ${set.pageCount === 1 ? "page" : "pages"}`;
const made = (set: DocSetSummary) => new Date(set.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

// CLEAN: shows which duplicate doc sets go and which stay, then hides the duplicates
export function CleanDocsDialog({ open, onOpenChange, sets }: { open: boolean; onOpenChange: (open: boolean) => void; sets: DocSetSummary[] }) {
  const router = useRouter();
  const groups = planDocCleanup(sets);
  const ids = docSetsToRetire(groups);
  const clean = useServerAction(cleanDocSets, { progress: { title: "Cleaning docs…" }, refreshTables: [] });

  const run = async () => {
    const result = await clean.run(ids);
    if (!result.ok) return;
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!clean.isPending) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            Clean docs
            <InfoHint>Docs made from the same source are duplicates. The newest finished set stays.</InfoHint>
          </DialogTitle>
          <DialogDescription>
            {ids.length ? `${ids.length} duplicate ${ids.length === 1 ? "set" : "sets"} will be hidden with their pages. Nothing is deleted.` : "No duplicate docs."}
          </DialogDescription>
        </DialogHeader>
        {groups.length ? (
          <ul className="flex max-h-80 flex-col gap-3 overflow-y-auto text-panel">
            {groups.map((group) => (
              <li key={group.keep.id} className="flex flex-col gap-1">
                <p><span className="font-medium">Keeps</span> {group.keep.title} <span className="text-muted-foreground">· {pages(group.keep)} · {made(group.keep)}</span></p>
                {group.retire.map((set) => (
                  <p key={set.id} className="pl-4 text-muted-foreground"><span className="text-foreground">Hides</span> {set.title} · {pages(set)} · {made(set)}</p>
                ))}
              </li>
            ))}
          </ul>
        ) : null}
        {clean.error ? <p role="alert">{clean.error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={clean.isPending} onClick={() => onOpenChange(false)}>Cancel</Button>
          {ids.length ? <Button type="button" disabled={clean.isPending} onClick={run}>{clean.isPending ? "Cleaning…" : "Clean"}</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
