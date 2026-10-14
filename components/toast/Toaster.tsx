"use client";

import { Toaster as Sonner } from "sonner";
import { StatusDot } from "@/app/(app)/_components/StatusDot";

// =====================================================================
// TOASTER: where error toasts appear (bottom-right, newest on top).
// Unstyled Sonner drawn with the app's own tokens: monochrome card,
// the Dull Red dot as the only color, so toasts match ErrorNote.
// =====================================================================

// TOAST CARD STYLE: same surface, border and text size as the rest of the app
const TOAST_CLASS_NAMES = {
  toast: "flex w-80 items-start gap-2 rounded-md border bg-background p-3 text-panel text-text shadow-lg",
  icon: "mt-1.5",
  title: "font-medium",
  description: "text-muted-foreground",
};

export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{ unstyled: true, classNames: TOAST_CLASS_NAMES }}
      icons={{ error: <StatusDot tone="failed" /> }}
    />
  );
}
