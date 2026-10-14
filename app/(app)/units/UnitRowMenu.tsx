"use client";

import { UnitActionForm, unitModeLabel, unitModes } from "@/components/actions/ActionDialog";
import { RowMenu, type RowMenuItem } from "@/components/row-menu/RowMenu";
import type { UnitSummary } from "@/lib/queries/screens";

// "…" MENU FOR ONE UNIT: open it, or any edit it allows (Retire is the delete; undo it from Changes)
export function UnitRowMenu({ unit }: { unit: UnitSummary }) {
  const edits: RowMenuItem[] = unitModes(unit).map((mode) => ({
    label: unitModeLabel(mode),
    isDestructive: mode === "retire",
    body: (close) => <UnitActionForm mode={mode} unit={unit} onDone={close} />,
  }));
  return <RowMenu label={unit.content} items={[{ label: "Open", href: `/units/${unit.id}` }, ...edits]} />;
}
