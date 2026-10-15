"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { MoreIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

// =====================================================================
// ROW MENU: the "…" button at the end of a table row. Each item either
// opens a page (href) or opens a dialog (body). The dialog lives outside
// the menu so it stays open after the menu closes.
// =====================================================================

export type RowMenuItem = {
  label: string;
  isDestructive?: boolean;
  isDisabled?: boolean;
} & ({ href: string; body?: never } | { body: (close: () => void) => ReactNode; href?: never });

type RowMenuProps = { label: string; items: readonly RowMenuItem[] };

// "…" MENU FOR ONE ROW; `label` names the row for screen readers
export function RowMenu({ label, items }: RowMenuProps) {
  const router = useRouter();
  const [openItem, setOpenItem] = useState<RowMenuItem | null>(null);
  const close = () => setOpenItem(null);
  const choose = (item: RowMenuItem) => (item.href ? router.push(item.href) : setOpenItem(item));
  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={`Actions for ${label}`}>
            <MoreIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {items.map((item) => (
            <DropdownMenuItem
              key={item.label}
              variant={item.isDestructive ? "destructive" : "default"}
              disabled={item.isDisabled}
              onSelect={() => choose(item)}
            >
              {item.label}
            </DropdownMenuItem>
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
