"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useServerAction } from "@/components/actions/useServerAction";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { renameDocSet } from "./actions";

// RENAME DOC: mounted only while open, so the name starts from the doc's current title
export function RenameDocsDialog({ set, onClose }: { set: { id: string; title: string }; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(set.title);
  const rename = useServerAction(renameDocSet, { progress: { title: "Renaming…" }, refreshTables: [] });
  const name = title.trim();

  const save = async () => {
    const result = await rename.run(set.id, name);
    if (!result.ok) return;
    onClose();
    router.refresh();
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !rename.isPending) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(event) => { event.preventDefault(); if (name && !rename.isPending) save(); }} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Rename doc</DialogTitle>
            <DialogDescription>The new name shows in Docs and on exports.</DialogDescription>
          </DialogHeader>
          <Input aria-label="Doc name" value={title} maxLength={200} disabled={rename.isPending} autoFocus onChange={(event) => setTitle(event.target.value)} />
          {rename.error ? <p role="alert" className="text-panel text-destructive">{rename.error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={rename.isPending} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!name || rename.isPending}>{rename.isPending ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
