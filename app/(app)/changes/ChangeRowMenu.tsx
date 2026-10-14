"use client";

import { DialogForm } from "@/components/actions/DialogForm";
import { useServerAction } from "@/components/actions/useServerAction";
import { RowMenu } from "@/components/row-menu/RowMenu";
import type { Tables } from "@/lib/database/types";
import { undoChangeSet } from "@/lib/server-actions/knowledge";
import { UNDOABLE } from "./[id]/UndoButton";

type ChangeSet = Tables<"change_sets">;

// "…" MENU FOR ONE CHANGE: open it, or undo it (only when something was applied)
export function ChangeRowMenu({ changeSet }: { changeSet: ChangeSet }) {
  return (
    <RowMenu
      label={changeSet.summary}
      items={[
        { label: "Open", href: `/changes/${changeSet.id}` },
        {
          label: "Undo",
          isDestructive: true,
          isDisabled: !UNDOABLE.has(changeSet.status),
          body: (close) => <UndoForm changeSet={changeSet} onDone={close} />,
        },
      ]}
    />
  );
}

// CONFIRM UNDO: reverts every applied action of the set through Change control
function UndoForm({ changeSet, onDone }: { changeSet: ChangeSet; onDone: () => void }) {
  const undo = useServerAction(undoChangeSet);
  const submit = async () => {
    if ((await undo.run(changeSet.id)).ok) onDone();
  };
  return (
    <DialogForm
      title="Undo this change?"
      description={`“${changeSet.summary}” is reverted. The undo is itself a change you can see in history.`}
      submitLabel="Undo"
      isDestructive
      isPending={undo.isPending}
      error={undo.error}
      onSubmit={submit}
    />
  );
}
