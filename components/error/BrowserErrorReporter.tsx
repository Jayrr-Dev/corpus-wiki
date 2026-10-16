"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/server-actions/errors";

// =====================================================================
// BROWSER ERROR REPORTER: errors no boundary catches (an event handler
// that throws, a promise nobody awaited) go to the error log (/errors).
// Mounted once in the signed-in layout; renders nothing.
// =====================================================================

export function BrowserErrorReporter() {
  useEffect(() => {
    const send = (where: string, error: unknown, fallback: string) => {
      const message = error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
      void reportClientError({ where, message: message || fallback, path: window.location.pathname, stack: error instanceof Error ? error.stack : undefined }).catch(() => {});
    };
    const onError = (event: ErrorEvent) => send("Browser", event.error ?? event.message, "Script error");
    const onRejection = (event: PromiseRejectionEvent) => send("Unhandled promise", event.reason, "Promise rejected");
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
