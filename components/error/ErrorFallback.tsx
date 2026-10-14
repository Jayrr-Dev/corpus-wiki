"use client";

import { useEffect } from "react";
import { ErrorNote } from "@/app/(app)/_components/bits";
import { ExceptionIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/server-actions/errors";
import { cn } from "@/lib/utils";

// =====================================================================
// ERROR FALLBACK: what any error boundary shows in place of the part
// that crashed. One look for every boundary: the icon, what broke, the
// message (inline and as a toast, through ErrorNote) and a Retry button.
// It also reports the crash to the server log once.
// =====================================================================

type ErrorFallbackProps = {
  error: Error & { digest?: string };
  // Names the part that broke, e.g. "This page" or "This section"
  where: string;
  onRetry: () => void;
  // Smaller padding for a panel or a section inside a page
  isCompact?: boolean;
};

export function ErrorFallback({ error, where, onRetry, isCompact = false }: ErrorFallbackProps) {
  useEffect(() => {
    void reportClientError({ where, message: error.message, digest: error.digest, path: window.location.pathname }).catch(() => {});
  }, [error, where]);

  return (
    <div role="alert" className={cn("flex flex-col items-center gap-2 text-center text-muted-foreground", isCompact ? "py-4" : "py-12")}>
      <ExceptionIcon className="text-faint" />
      <p className="text-panel">{where} could not be shown.</p>
      <ErrorNote error={error.message || "Something went wrong."} />
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
