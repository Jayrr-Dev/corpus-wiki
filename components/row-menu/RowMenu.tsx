"use client";

import { useRouter } from "next/navigation";
import { Fragment, type ReactNode, useState } from "react";
import { MoreIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/standard/tooltip";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { orderMenuItems } from "./menuOrder";

// =====================================================================
// ROW MENU: the "…" button at the end of a table row. Each item either
// opens a page (href), opens a dialog (body) or runs at once (run). The
// dialog lives outside the menu so it stays open after the menu closes.
// =====================================================================

export type RowMenuItem = {
  label: string;
  isDestructive?: boolean;
  // Blue, for the item that brings something new in (e.g. Replace)
  isAccent?: boolean;
  isDisabled?: boolean;
  // Starts a new group (divider above). Destructive items are moved last,
  // below their own divider, by orderMenuItems
  separatorBefore?: boolean;
  // Hint shown in a tooltip beside the item, e.g. why it is disabled
  title?: string;
  // A wide dialog (e.g. for a preview) instead of the form-sized one
  isWide?: boolean;
} & (
  | { href: string; body?: never; run?: never }
  | { body: (close: () => void) => ReactNode; href?: never; run?: never }
  | { run: () => void; href?: never; body?: never }
);

type RowMenuProps = { label: string; items: readonly RowMenuItem[] };

// "…" MENU FOR ONE ROW; `label` names the row for screen readers
export function RowMenu({ label, items }: RowMenuProps) {
  const router = useRouter();
  const [openItem, setOpenItem] = useState<RowMenuItem | null>(null);
  const close = () => setOpenItem(null);
  const choose = (item: RowMenuItem) => {
    if (item.href) router.push(item.href);
    else if (item.run) item.run();
    else setOpenItem(item);
  };
  return (
    <div className="flex justify-end">
      {/* Not modal: a modal menu handing off to the dialog leaves `pointer-events: none` on <body> */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={`Actions for ${label}`}>
            <MoreIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {orderMenuItems(items).map(({ item, hasSeparator }) => {
            const menuItem = (
              <DropdownMenuItem
                variant={item.isDestructive ? "destructive" : "default"}
                disabled={item.isDisabled}
                className={item.isAccent ? "text-link focus:text-link" : undefined}
                onSelect={() => choose(item)}
              >
                {item.label}
              </DropdownMenuItem>
            );
            return (
              <Fragment key={item.label}>
                {hasSeparator && <DropdownMenuSeparator />}
                {/* The wrapper takes the hover: a disabled item ignores the pointer */}
                {item.title ? <Tooltip content={item.title} side="left"><div>{menuItem}</div></Tooltip> : menuItem}
              </Fragment>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={openItem !== null} onOpenChange={(isOpen) => !isOpen && close()}>
        <DialogContent className={openItem?.isWide ? "sm:max-w-4xl" : "sm:max-w-lg"}>{openItem?.body ? openItem.body(close) : null}</DialogContent>
      </Dialog>
    </div>
  );
}

// COLUMN DEF for the menu column (no header, no sorting)
export function menuColumn<T>(render: (row: T) => ReactNode) {
  return { id: "menu", header: "", enableSorting: false, cell: ({ row }: { row: { original: T } }) => render(row.original) };
}
