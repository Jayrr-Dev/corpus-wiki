"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState, type ReactNode } from "react";
import { RoutedErrorBoundary } from "@/components/error";
import { Toaster } from "@/components/toast";
import { TooltipProvider } from "@/components/standard/tooltip";

// QUERY DEFAULTS: Realtime (agent D) pushes changes, so polling and focus refetch stay off
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
  });
}

// THEME SCRIPT: next-themes renders an inline <script> that sets the theme before React loads.
// It only needs to run from the server HTML; on a client render React 19 warns about any script tag,
// so there it becomes an inert text/plain block (React skips the warning for non-JS script types).
const THEME_SCRIPT_PROPS = {
  type: typeof window === "undefined" ? "text/javascript" : "text/plain",
  suppressHydrationWarning: true,
} as const;

// CLIENT PROVIDERS: the theme (a .light or .dark class on <html>), one QueryClient per browser tab, the tooltip provider and the error toaster
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange scriptProps={THEME_SCRIPT_PROPS}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          {children}
          <RoutedErrorBoundary where="Notifications">
            <Toaster />
          </RoutedErrorBoundary>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
