"use client";

import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { useLayoutEffect, useState, type ReactNode } from "react";
import { TimeZoneProvider } from "@/app/(app)/_components/DateTime";
import { SpaceProvider } from "@/components/shell/SpaceProvider";
import { TooltipProvider } from "@/components/standard/tooltip";
import { FeatureFlagsProvider } from "@/lib/flags/client";
import { defaultFeatureFlags, type FeatureFlags } from "@/lib/flags/registry";
import { PHOENIX_SPACE } from "@/lib/video-stage/phoenix/core";
import type { Space } from "@/lib/spaces/shared";

// =====================================================================
// STAGE PROVIDERS: everything the app's real components need, fed with
// synthetic data. The QueryClient never fetches: a scene seeds the keys
// its components read (`seed`), and any key it forgot stays loading and
// is named once in the console, so frames never depend on the network.
// =====================================================================

const warned = new Set<string>();

// Never resolves: an unseeded query stays in its loading state
function unseeded(queryKey: QueryKey): Promise<never> {
  const key = JSON.stringify(queryKey);
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(`[stage] unseeded query ${key}; seed it with qc.setQueryData(${key}, …)`);
  }
  return new Promise<never>(() => {});
}

// A QueryClient whose queries only ever read the cache: each component's own queryFn is
// swapped out after defaults are merged, polling is off, and Realtime invalidations are ignored
export function makeStageQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, gcTime: Infinity, retry: false, refetchOnWindowFocus: false, refetchOnMount: false, refetchOnReconnect: false },
      mutations: { retry: false },
    },
  });
  const merge = client.defaultQueryOptions.bind(client);
  client.defaultQueryOptions = ((options: Parameters<QueryClient["defaultQueryOptions"]>[0]) => {
    const defaulted = merge(options);
    return { ...defaulted, queryFn: () => unseeded(defaulted.queryKey), refetchInterval: false, retry: false, staleTime: Infinity };
  }) as QueryClient["defaultQueryOptions"];
  client.invalidateQueries = () => Promise.resolve();
  client.refetchQueries = () => Promise.resolve();
  return client;
}

// The tutorial opens on a first visit (empty localStorage), which a fresh headless browser always is
function closeTutorialForStage() {
  try {
    window.localStorage.setItem("second-brain:tutorial", JSON.stringify({ isOpen: false, stepIndex: 0 }));
  } catch { /* storage may be disabled; the tutorial then opens from memory */ }
}

// FORCE DARK: the root layout's next-themes provider owns <html>'s class and a nested
// ThemeProvider is a no-op, so the stage pins the dark class itself while it is mounted
function useForceDark() {
  useLayoutEffect(() => {
    const html = document.documentElement;
    const before = { className: html.className, colorScheme: html.style.colorScheme };
    const apply = () => {
      if (html.classList.contains("light")) html.classList.remove("light");
      if (!html.classList.contains("dark")) html.classList.add("dark");
      if (html.style.colorScheme !== "dark") html.style.colorScheme = "dark";
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(html, { attributes: true, attributeFilter: ["class", "style"] });
    return () => {
      observer.disconnect();
      html.className = before.className;
      html.style.colorScheme = before.colorScheme;
    };
  }, []);
}

export type StageProvidersProps = {
  // fills the cache before the first render: qc.setQueryData(key, rows)
  seed?: (qc: QueryClient) => void;
  space?: Space;
  flags?: Partial<FeatureFlags>;
  children: ReactNode;
};

export function StageProviders({ seed, space = PHOENIX_SPACE, flags, children }: StageProvidersProps) {
  const [queryClient] = useState(() => {
    closeTutorialForStage();
    const client = makeStageQueryClient();
    seed?.(client);
    return client;
  });
  const [featureFlags] = useState<FeatureFlags>(() => ({ ...defaultFeatureFlags(), ...flags }));
  useForceDark();
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SpaceProvider space={space}>
          <FeatureFlagsProvider flags={featureFlags}>
            <TimeZoneProvider timeZone="UTC">{children}</TimeZoneProvider>
          </FeatureFlagsProvider>
        </SpaceProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
