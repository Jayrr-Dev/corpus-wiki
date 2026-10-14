"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Tables } from "@/lib/database/types";
import { cn } from "@/lib/utils";
import { DeleteForm, RenameForm } from "./PageRowActions";

type Page = Tables<"pages">;

// WHICH DIALOG THE MENU OPENED (none while closed)
type OpenDialog = "rename" | "delete" | null;

// PAGE MENU: a "…" button (shown on row hover or focus) with Rename and Delete.
// The dialogs live outside the menu so they stay open after the menu closes.
export function PageMenu({ page, className }: { page: Page; className?: string }) {
  const [openDialog, setOpenDialog] = useState<OpenDialog>(null);
  const close = () => setOpenDialog(null);
  const leaveIfOpen = useLeaveDeletedPage(page.slug);
  const onDeleted = () => {
    close();
    leaveIfOpen();
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={`Actions for ${page.title}`} className={cn("-my-1 data-[state=open]:visible", className)}>
            …
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setOpenDialog("rename")}>Rename</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setOpenDialog("delete")}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={openDialog !== null} onOpenChange={(isOpen) => !isOpen && close()}>
        <DialogContent>
          {openDialog === "rename" ? <RenameForm page={page} onDone={close} /> : null}
          {openDialog === "delete" ? <DeleteForm page={page} onDone={onDeleted} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

// After a delete: leaves the page's own screen (it no longer exists), else stays put
function useLeaveDeletedPage(slug: string): () => void {
  const router = useRouter();
  const pathname = usePathname();
  return () => {
    if (pathname === `/p/${slug}`) router.push("/");
  };
}
