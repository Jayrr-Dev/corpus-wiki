"use client";

import { type FormEvent, type ReactNode, useState } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { FormRow } from "@/components/actions/FormRow";
import { useServerAction } from "@/components/actions/useServerAction";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Tables } from "@/lib/database/types";
import { deletePage, renamePage } from "@/lib/server-actions/pages";

type Page = Tables<"pages">;

// ROW ACTIONS: rename and delete for one page
export function PageRowActions({ page }: { page: Page }) {
  return (
    <div className="flex justify-end gap-1">
      <RowDialog label="Rename">{(close) => <RenameForm page={page} onDone={close} />}</RowDialog>
      <RowDialog label="Delete">{(close) => <DeleteForm page={page} onDone={close} />}</RowDialog>
    </div>
  );
}

// SMALL GHOST BUTTON THAT OPENS A DIALOG; the body gets a close callback
function RowDialog({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>{isOpen ? children(() => setIsOpen(false)) : null}</DialogContent>
    </Dialog>
  );
}

// RENAME: new title (the URL slug stays the same); also used by the sidebar page menu
export function RenameForm({ page, onDone }: { page: Page; onDone: () => void }) {
  const [title, setTitle] = useState(page.title);
  const rename = useServerAction(renamePage);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if ((await rename.run(page.id, title)).ok) onDone();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Rename page</DialogTitle>
        <DialogDescription>The address stays /p/{page.slug}.</DialogDescription>
      </DialogHeader>
      <FormRow htmlFor="rename-title" label="Title">
        <Input id="rename-title" value={title} onChange={(event) => setTitle(event.target.value)} required />
      </FormRow>
      <ErrorNote error={rename.error} />
      <FormButtons isPending={rename.isPending} submitLabel="Rename" isDisabled={!title.trim()} />
    </form>
  );
}

// DELETE: confirm; knowledge units are not touched; also used by the sidebar page menu
export function DeleteForm({ page, onDone }: { page: Page; onDone: () => void }) {
  const remove = useServerAction(deletePage);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if ((await remove.run(page.id)).ok) onDone();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Delete “{page.title}”?</DialogTitle>
        <DialogDescription>The page and its sections go. The knowledge units it showed stay.</DialogDescription>
      </DialogHeader>
      <ErrorNote error={remove.error} />
      <FormButtons isPending={remove.isPending} submitLabel="Delete" variant="destructive" />
    </form>
  );
}

type FormButtonsProps = { isPending: boolean; submitLabel: string; isDisabled?: boolean; variant?: "default" | "destructive" };

// CANCEL + SUBMIT
function FormButtons({ isPending, submitLabel, isDisabled = false, variant = "default" }: FormButtonsProps) {
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
