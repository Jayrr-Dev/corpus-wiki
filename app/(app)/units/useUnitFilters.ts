"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { readUnitFilters, type UnitFilters } from "./filterUnits";

export type UnitFilterState = { filters: UnitFilters; setFilter: (key: keyof UnitFilters, value: string) => void };

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
  return { filters, setFilter };
}
