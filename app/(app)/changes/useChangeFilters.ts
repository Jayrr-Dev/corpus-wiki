"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { CHANGE_FILTER_KEYS, type ChangeFilters, readChangeFilters } from "./filterChanges";

export type ChangeFilterState = { filters: ChangeFilters; setFilter: (key: keyof ChangeFilters, value: string) => void; resetFilters: () => void };

// URL-BACKED FILTERS: reading and writing /changes search params (no history entry per change)
export function useChangeFilters(): ChangeFilterState {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const replace = (next: URLSearchParams) => router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  const setFilter = (key: keyof ChangeFilters, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    replace(next);
  };
  const filters = useMemo(() => readChangeFilters(params), [params]);
  const resetFilters = () => {
    const next = new URLSearchParams(params.toString());
    for (const key of CHANGE_FILTER_KEYS) next.delete(key);
    replace(next);
  };
  return { filters, setFilter, resetFilters };
}
