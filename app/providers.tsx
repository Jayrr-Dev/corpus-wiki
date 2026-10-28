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

// CLIENT PROVIDERS: the theme (a .light or .dark class on <html>), one QueryClient per browser tab, the tooltip provider and the error toaster
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
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
