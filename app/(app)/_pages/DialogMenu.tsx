"use client";

import { Fragment, type ReactNode, useState } from "react";
import { ActionHint } from "@/components/actions/ActionHint";
import { MoreIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { orderMenuItems } from "@/components/row-menu/menuOrder";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// ONE MENU ENTRY: its label and the dialog body it opens (given a close callback).
// `separatorBefore` starts a new group; destructive items are moved last (see menuOrder); `hint` adds an "i" that explains it
export type DialogMenuItem = { label: string; hint?: string; isDestructive?: boolean; separatorBefore?: boolean; render: (close: () => void) => ReactNode };

type DialogMenuProps = { label: string; items: DialogMenuItem[]; className?: string };

// DIALOG MENU: a "…" button whose entries each open a dialog. The dialog lives
// outside the menu so it stays open after the menu closes. `className` lets a
// row hide the button until hover (it stays visible while the menu is open).
export function DialogMenu({ label, items, className }: DialogMenuProps) {
  const [openItem, setOpenItem] = useState<DialogMenuItem | null>(null);
  const close = () => setOpenItem(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={label} className={cn("-my-1 data-[state=open]:visible", className)}>
            <MoreIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {orderMenuItems(items).map(({ item, hasSeparator }) => (
            <Fragment key={item.label}>
              {hasSeparator && <DropdownMenuSeparator />}
              <DropdownMenuItem variant={item.isDestructive ? "destructive" : "default"} onSelect={() => setOpenItem(item)}>
                {item.label}
                {item.hint && <ActionHint>{item.hint}</ActionHint>}
              </DropdownMenuItem>
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={openItem !== null} onOpenChange={(isOpen) => !isOpen && close()}>
        <DialogContent>{openItem ? openItem.render(close) : null}</DialogContent>
      </Dialog>
    </>
  );
}
