"use client";

import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react";
import { DEFAULT_TIME_ZONE, formatDateTime } from "@/app/(app)/_lib/format";

// =====================================================================
// Prefer the zone picked in Settings; otherwise follow the device.
// The server snapshot keeps the first browser render consistent with SSR.
// =====================================================================

const TimeZoneContext = createContext(DEFAULT_TIME_ZONE);

const subscribe = () => () => {};
const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE;
const serverTimeZone = () => DEFAULT_TIME_ZONE;

export function TimeZoneProvider({ timeZone, children }: { timeZone: string | null; children: ReactNode }) {
  const deviceZone = useSyncExternalStore(subscribe, deviceTimeZone, serverTimeZone);
  return <TimeZoneContext.Provider value={timeZone ?? deviceZone}>{children}</TimeZoneContext.Provider>;
}

export function useTimeZone(): string {
  return useContext(TimeZoneContext);
}

// A moment as "Feb 25, 26 @ 9:30 pm" in the chosen time zone
export function DateTime({ iso }: { iso: string | null | undefined }) {
  return <>{formatDateTime(iso, useTimeZone())}</>;
}
