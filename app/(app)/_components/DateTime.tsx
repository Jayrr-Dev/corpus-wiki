"use client";

import { createContext, type ReactNode, useContext } from "react";
import { DEFAULT_TIME_ZONE, formatDateTime } from "@/app/(app)/_lib/format";

// =====================================================================
// TIME ZONE: the zone picked in Settings (a cookie, read in the layout)
// reaches every date-and-time on screen through this context.
// =====================================================================

const TimeZoneContext = createContext(DEFAULT_TIME_ZONE);

export function TimeZoneProvider({ timeZone, children }: { timeZone: string; children: ReactNode }) {
  return <TimeZoneContext.Provider value={timeZone}>{children}</TimeZoneContext.Provider>;
}

export function useTimeZone(): string {
  return useContext(TimeZoneContext);
}

// A moment as "Feb 25, 26 @ 9:30 pm" in the chosen time zone
export function DateTime({ iso }: { iso: string | null | undefined }) {
  return <>{formatDateTime(iso, useTimeZone())}</>;
}
