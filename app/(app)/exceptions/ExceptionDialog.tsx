"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Tables } from "@/lib/database/types";
import type { UnitSummary } from "@/lib/queries/screens";
import { ExceptionCard } from "./ExceptionCard";
import { useRef } from "react";

export function ExceptionDialog({ exception, action, unit, before, onClose }: {
  exception: Tables<"exceptions"> | undefined; action: Tables<"actions"> | undefined;
  unit: UnitSummary | undefined; before: string | null; onClose: () => void;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  return <Dialog open={Boolean(exception)} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl" onOpenAutoFocus={(event) => { event.preventDefault(); title.current?.focus(); }}>
      <DialogHeader>
        <DialogTitle ref={title} tabIndex={-1}>Review exception</DialogTitle>
        <DialogDescription>Review the evidence and proposed change, then approve or reject it.</DialogDescription>
      </DialogHeader>
      {exception && <ExceptionCard key={exception.id} exception={exception} action={action} unit={unit} before={before} />}
    </DialogContent>
  </Dialog>;
}
