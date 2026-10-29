"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useServerAction } from "@/components/actions/useServerAction";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { deleteDocSet, renameDocSet } from "../actions";

// Admin-only dialogs on the reader's top bar. Each one is mounted only while open,
// so it always starts from the doc's current title.

// RENAME: the doc set's title
export function RenameDocSetDialog({ docSetId, title, onOpenChange }: { docSetId: string; title: string; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [name, setName] = useState(title);
  const rename = useServerAction(renameDocSet, { progress: { title: "Renaming…" }, refreshTables: [] });
  const trimmed = name.trim();

  const save = async () => {
    const result = await rename.run(docSetId, trimmed);
    if (!result.ok) return;
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!rename.isPending) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename doc</DialogTitle>
          <DialogDescription>The new name shows on the Docs list and in the reader.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); if (trimmed && trimmed !== title) void save(); }}>
          <Input value={name} onChange={(event) => setName(event.target.value)} aria-label="Doc name" maxLength={200} autoFocus />
          {rename.error ? <p role="alert" className="text-panel text-destructive">{rename.error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={rename.isPending} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={rename.isPending || !trimmed || trimmed === title}>{rename.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// DELETE: hides the doc set and its pages (soft delete, the same as Clean). The copy says so
// plainly and that the doc leaves the list.
export function DeleteDocSetDialog({ docSetId, title, onOpenChange }: { docSetId: string; title: string; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const remove = useServerAction(deleteDocSet, { progress: { title: "Deleting…" }, refreshTables: [] });

  const run = async () => {
    const result = await remove.run(docSetId);
    if (!result.ok) return;
    onOpenChange(false);
    router.push("/docs");
    router.refresh();
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!remove.isPending) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete “{title}”?</DialogTitle>
          <DialogDescription>
            The doc and its pages leave Docs. Nothing is erased from the database.
          </DialogDescription>
        </DialogHeader>
        {remove.error ? <p role="alert" className="text-panel text-destructive">{remove.error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={remove.isPending} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" variant="destructive" disabled={remove.isPending} onClick={run}>{remove.isPending ? "Deleting…" : "Delete doc"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
