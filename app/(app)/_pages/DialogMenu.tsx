"use client";

import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// ONE MENU ENTRY: its label and the dialog body it opens (given a close callback)
export type DialogMenuItem = { label: string; isDestructive?: boolean; render: (close: () => void) => ReactNode };

type DialogMenuProps = { label: string; items: DialogMenuItem[]; className?: string };

// DIALOG MENU: a "…" button whose entries each open a dialog. The dialog lives
// outside the menu so it stays open after the menu closes. `className` lets a
// row hide the button until hover (it stays visible while the menu is open).
export function DialogMenu({ label, items, className }: DialogMenuProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const close = () => setOpenIndex(null);
  const openItem = openIndex === null ? null : items[openIndex];
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={label} className={cn("-my-1 data-[state=open]:visible", className)}>
            …
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {items.map((item, index) => (
            <DropdownMenuItem key={item.label} variant={item.isDestructive ? "destructive" : "default"} onSelect={() => setOpenIndex(index)}>
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={openItem !== null} onOpenChange={(isOpen) => !isOpen && close()}>
        <DialogContent>{openItem ? openItem.render(close) : null}</DialogContent>
      </Dialog>
    </>
  );
}
