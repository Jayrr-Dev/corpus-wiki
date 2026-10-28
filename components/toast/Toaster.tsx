"use client";

import { Toaster as Sonner } from "sonner";
import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { ProgressDock, PROGRESS_DOCK_LIFT, useCollapsedProgress } from "./ProgressToast";

// =====================================================================
// TOASTER: where error and progress toasts appear (bottom-right).
// Expanded, so several processes running at once stack visibly.
// Unstyled Sonner drawn with the app's own tokens: monochrome card,
// the Dull Red dot as the only color, so toasts match ErrorNote.
// =====================================================================

// TOAST CARD STYLE: same surface, border and text size as the rest of the app
const TOAST_CLASS_NAMES = {
  toast: "flex w-80 items-start gap-2 rounded-md border bg-background p-3 text-panel text-text shadow-lg",
  // one text line tall, dot centered in it, so it lines up with the title
  icon: "flex h-lh shrink-0 items-center",
  title: "font-medium",
  description: "text-muted-foreground",
};

export function Toaster() {
  const collapsed = useCollapsedProgress();
  const lift = collapsed.length > 0 ? PROGRESS_DOCK_LIFT : 0;
  return (
    <>
      <Sonner
        position="bottom-right"
        expand
        offset={{ right: 40, bottom: 24 + lift }}
        visibleToasts={6}
        toastOptions={{ unstyled: true, classNames: TOAST_CLASS_NAMES }}
        icons={{ error: <StatusDot tone="failed" /> }}
      />
      <ProgressDock items={collapsed} />
    </>
  );
}
