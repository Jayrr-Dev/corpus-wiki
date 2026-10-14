"use client";

import { ErrorFallback } from "@/components/error";

// ROUTE ERROR (outside the app shell, e.g. sign-in)
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <ErrorFallback error={error} where="This page" onRetry={reset} />
    </div>
  );
}
