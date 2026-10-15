"use client";

import type { DeleteRetiredResult } from "@/lib/knowledge/deleteRetired";
import type { ActionResult } from "@/lib/server-actions/result";
import { DialogForm } from "./DialogForm";
import { useServerAction } from "./useServerAction";

type DeleteRetiredFormProps = {
  title: string;
  description: string;
  action: (id: string) => Promise<ActionResult<DeleteRetiredResult>>;
  id: string;
  onDone: () => void;
};

// DELETE A RETIRED DOMAIN OR ENTITY: confirm, then it is gone for good (no undo)
export function DeleteRetiredForm({ title, description, action, id, onDone }: DeleteRetiredFormProps) {
  const remove = useServerAction(action);
  return (
    <DialogForm
      title={title}
      description={description}
      submitLabel="Delete"
      isDestructive
      isPending={remove.isPending}
      error={remove.error}
      onSubmit={async () => {
        if ((await remove.run(id)).ok) onDone();
      }}
    />
  );
}
