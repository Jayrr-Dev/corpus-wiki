"use client";

import { ErrorFallback } from "@/components/error";

// PAGE ERROR (every signed-in page): the shell stays, only the page area shows the error
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorFallback error={error} where="This page" onRetry={reset} />;
}
