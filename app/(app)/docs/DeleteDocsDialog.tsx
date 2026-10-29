"use client";

import { useRouter } from "next/navigation";
import { useServerAction } from "@/components/actions/useServerAction";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deleteDocSet } from "./actions";

// DELETE DOC: hides the doc and its pages (soft delete, like Clean). Mounted only while open.
export function DeleteDocsDialog({ set, onClose }: { set: { id: string; title: string }; onClose: () => void }) {
  const router = useRouter();
  const remove = useServerAction(deleteDocSet, { progress: { title: "Deleting…" }, refreshTables: [] });

  const run = async () => {
    const result = await remove.run(set.id);
    if (!result.ok) return;
    onClose();
    router.push("/docs");
    router.refresh();
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !remove.isPending) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {set.title}?</DialogTitle>
          <DialogDescription>This hides the doc and all its pages from Docs. Nothing is erased.</DialogDescription>
        </DialogHeader>
        {remove.error ? <p role="alert" className="text-panel text-destructive">{remove.error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={remove.isPending} onClick={onClose}>Cancel</Button>
          <Button type="button" variant="destructive" disabled={remove.isPending} onClick={run}>{remove.isPending ? "Deleting…" : "Delete"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
