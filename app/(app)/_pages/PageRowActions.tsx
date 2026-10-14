"use client";

import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import type { Tables } from "@/lib/database/types";
import { deletePage, renamePage } from "@/lib/server-actions/pages";
import { ConfirmForm, TitleForm } from "./PageForms";

type Page = Tables<"pages">;

// ROW ACTIONS: rename and remove for one page
export function PageRowActions({ page }: { page: Page }) {
  return (
    <div className="flex justify-end gap-1">
      <RowDialog label="Rename">{(close) => <RenameForm page={page} onDone={close} />}</RowDialog>
      <RowDialog label="Remove">{(close) => <DeleteForm page={page} onDone={close} />}</RowDialog>
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

// RENAME: new title (the URL slug stays the same); also used by the page menus
export function RenameForm({ page, onDone }: { page: Page; onDone: () => void }) {
  return (
    <TitleForm
      heading="Rename page"
      description={`The address stays /p/${page.slug}. You can undo this on the Changes screen.`}
      initialTitle={page.title}
      submitLabel="Rename"
      onSubmit={(title) => renamePage(page.id, title)}
      onDone={onDone}
    />
  );
}

// REMOVE: confirm; knowledge units are not touched; also used by the page menus
export function DeleteForm({ page, onDone }: { page: Page; onDone: () => void }) {
  return (
    <ConfirmForm
      heading={`Remove “${page.title}”?`}
      description="The page and its sections leave the wiki. The knowledge units it showed stay. You can undo this on the Changes screen."
      submitLabel="Remove"
      onSubmit={() => deletePage(page.id)}
      onDone={onDone}
    />
  );
}
