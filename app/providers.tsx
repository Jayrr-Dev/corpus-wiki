"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

// QUERY DEFAULTS: Realtime (agent D) pushes changes, so polling and focus refetch stay off
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
  });
}

// CLIENT PROVIDERS: one QueryClient per browser tab, plus the tooltip provider
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}
