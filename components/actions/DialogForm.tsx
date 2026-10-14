"use client";

import type { FormEvent, ReactNode } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { Button } from "@/components/ui/button";
import { DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type DialogFormProps = {
  title: string;
  description: string;
  submitLabel: string;
  isPending: boolean;
  error: string | null;
  onSubmit: () => Promise<void>;
  isDestructive?: boolean;
  isDisabled?: boolean;
  children?: ReactNode;
};

// DIALOG FORM: the frame every create, edit and confirm dialog shares
// (title, fields, the error as a note and a toast, Cancel + submit)
export function DialogForm({ title, description, submitLabel, isPending, error, onSubmit, isDestructive, isDisabled, children }: DialogFormProps) {
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSubmit();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {children}
      <ErrorNote error={error} />
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" variant={isDestructive ? "destructive" : "default"} disabled={isPending || isDisabled}>
          {isPending ? "Working…" : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
