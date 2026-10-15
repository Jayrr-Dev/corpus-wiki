"use client";

import { useRouter } from "next/navigation";
import { Fragment, type ReactNode, useState } from "react";
import { MoreIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

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
  // Draws a divider above this item, to group the menu
  separatorBefore?: boolean;
  title?: string;
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
          {items.map((item) => (
            <Fragment key={item.label}>
              {item.separatorBefore && <DropdownMenuSeparator />}
              <DropdownMenuItem
                variant={item.isDestructive ? "destructive" : "default"}
                disabled={item.isDisabled}
                title={item.title}
                className={item.isAccent ? "text-link focus:text-link" : undefined}
                onSelect={() => choose(item)}
              >
                {item.label}
              </DropdownMenuItem>
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={openItem !== null} onOpenChange={(isOpen) => !isOpen && close()}>
        <DialogContent className="sm:max-w-lg">{openItem?.body ? openItem.body(close) : null}</DialogContent>
      </Dialog>
    </div>
  );
}

// COLUMN DEF for the menu column (no header, no sorting)
export function menuColumn<T>(render: (row: T) => ReactNode) {
  return { id: "menu", header: "", enableSorting: false, cell: ({ row }: { row: { original: T } }) => render(row.original) };
}
