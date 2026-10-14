"use client";

import { useEffect } from "react";
import { toast } from "sonner";

// =====================================================================
// ERROR TOAST: pops a toast whenever a new error message appears.
// Renders nothing; ErrorNote mounts it next to every inline error, so
// every failed action, upload and load also shows up as a toast.
// The message doubles as the toast id: the same error shown twice (a
// re-render, React's dev double-effect, two notes) stays one toast.
// =====================================================================

export function ErrorToast({ message }: { message: string }) {
  useEffect(() => {
    toast.error(message, { id: message });
  }, [message]);
  return null;
}
