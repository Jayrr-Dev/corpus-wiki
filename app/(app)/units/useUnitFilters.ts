"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { FILTER_KEYS, readUnitFilters, type UnitFilters } from "./filterUnits";

export type UnitFilterState = { filters: UnitFilters; setFilter: (key: keyof UnitFilters, value: string) => void; resetFilters: () => void };

// URL-BACKED FILTERS: reading and writing /units search params (no history entry per change)
export function useUnitFilters(): UnitFilterState {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const setFilter = (key: keyof UnitFilters, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
  const filters = useMemo(() => readUnitFilters(params), [params]);
  const resetFilters = () => {
    const next = new URLSearchParams(params.toString());
    for (const key of FILTER_KEYS) next.delete(key);
    router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
  };
  return { filters, setFilter, resetFilters };
}

