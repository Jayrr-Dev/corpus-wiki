"use client";

import { type FormEvent, useState } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { FormRow } from "@/components/actions/FormRow";
import { useServerAction } from "@/components/actions/useServerAction";
import { Button } from "@/components/ui/button";
import { DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/server-actions/result";

// =====================================================================
// PAGE FORMS: the dialog bodies shared by page and section edits
// (Pages list, sidebar menu, section menu). Each submits one server
// action and closes on success; a refused change shows its reason.
// =====================================================================

type TitleFormProps = {
  heading: string;
  description: string;
  initialTitle: string;
  submitLabel: string;
  onSubmit: (title: string) => Promise<ActionResult>;
  onDone: () => void;
};

// TITLE FORM: one title field (rename a page or a section)
export function TitleForm({ heading, description, initialTitle, submitLabel, onSubmit, onDone }: TitleFormProps) {
  const [title, setTitle] = useState(initialTitle);
  const save = useServerAction(onSubmit);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if ((await save.run(title)).ok) onDone();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{heading}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <FormRow htmlFor="edit-title" label="Title">
        <Input id="edit-title" value={title} onChange={(event) => setTitle(event.target.value)} required />
      </FormRow>
      <ErrorNote error={save.error} />
      <FormButtons isPending={save.isPending} submitLabel={submitLabel} isDisabled={!title.trim() || title.trim() === initialTitle} />
    </form>
  );
}

type ConfirmFormProps = {
  heading: string;
  description: string;
  submitLabel: string;
  onSubmit: () => Promise<ActionResult>;
  onDone: () => void;
};

// CONFIRM FORM: a question and a destructive button (remove a page or a section)
export function ConfirmForm({ heading, description, submitLabel, onSubmit, onDone }: ConfirmFormProps) {
  const confirm = useServerAction(onSubmit);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if ((await confirm.run()).ok) onDone();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{heading}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <ErrorNote error={confirm.error} />
      <FormButtons isPending={confirm.isPending} submitLabel={submitLabel} variant="destructive" />
    </form>
  );
}

type FormButtonsProps = { isPending: boolean; submitLabel: string; isDisabled?: boolean; variant?: "default" | "destructive" };

// CANCEL + SUBMIT
export function FormButtons({ isPending, submitLabel, isDisabled = false, variant = "default" }: FormButtonsProps) {
  return (
    <DialogFooter>
      <DialogClose asChild>
        <Button type="button" variant="ghost">
          Cancel
        </Button>
      </DialogClose>
      <Button type="submit" variant={variant} disabled={isPending || isDisabled}>
        {isPending ? "Working…" : submitLabel}
      </Button>
    </DialogFooter>
  );
}
