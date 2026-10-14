"use client";

import { ErrorNote } from "@/app/(app)/_components/bits";
import { useServerAction } from "@/components/actions/useServerAction";
import { UndoIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { Tables } from "@/lib/database/types";
import { undoChangeSet } from "@/lib/server-actions/knowledge";

// STATUSES THAT CAN BE UNDONE (something was applied)
const UNDOABLE: ReadonlySet<Tables<"change_sets">["status"]> = new Set(["applied", "partly_applied"]);

// UNDO: reverts the whole set through Change control; errors show inline
export function UndoButton({ changeSet }: { changeSet: Tables<"change_sets"> }) {
  const undo = useServerAction(undoChangeSet);
  const isUndoable = UNDOABLE.has(changeSet.status);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" disabled={!isUndoable || undo.isPending} onClick={() => undo.run(changeSet.id)}>
        <UndoIcon />
        {undo.isPending ? "Undoing…" : "Undo"}
      </Button>
      <ErrorNote error={undo.error} />
    </div>
  );
}
