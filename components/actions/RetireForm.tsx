"use client";

import { useState } from "react";
import type { PersonAction } from "@/lib/change-control/types";
import { Textarea } from "@/components/ui/textarea";
import { DialogForm } from "./DialogForm";
import { FormRow } from "./FormRow";
import { useSubmitEdit } from "./useSubmitEdit";

type RetireFormProps = { title: string; description: string; build: (reason: string) => PersonAction; onDone: () => void };

// RETIRE (the delete for knowledge): asks why, sends the retire action; undo it from Changes
export function RetireForm({ title, description, build, onDone }: RetireFormProps) {
  const [reason, setReason] = useState("");
  const edit = useSubmitEdit(onDone);
  return (
    <DialogForm
      title={title}
      description={description}
      submitLabel="Retire"
      isDestructive
      isPending={edit.isPending}
      error={edit.error}
      isDisabled={!reason.trim()}
      onSubmit={() => edit.submit(build(reason))}
    >
      <FormRow htmlFor="retire-reason" label="Reason">
        <Textarea id="retire-reason" value={reason} onChange={(event) => setReason(event.target.value)} required />
      </FormRow>
    </DialogForm>
  );
}
