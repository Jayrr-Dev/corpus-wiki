"use client";

import { ErrorFallback } from "@/components/error";
import "./globals.css";

// GLOBAL ERROR: the root layout itself crashed, so this replaces the whole document
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center bg-background p-6 text-text">
        <ErrorFallback error={error} where="Corpus Wiki" onRetry={reset} />
      </body>
    </html>
  );
}
