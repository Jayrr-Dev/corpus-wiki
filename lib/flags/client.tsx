"use client";

import { createContext, type ReactNode, useContext } from "react";
import { type FeatureFlagKey, type FeatureFlags, defaultFeatureFlags } from "./registry";

// =====================================================================
// FEATURE FLAGS IN THE BROWSER: the signed-in layout reads the flags on the
// server and hands them down; components ask with useFeatureFlag(key).
// Outside the provider every flag is off.
// =====================================================================

const FeatureFlagsContext = createContext<FeatureFlags>(defaultFeatureFlags());

export function FeatureFlagsProvider({ flags, children }: { flags: FeatureFlags; children?: ReactNode }) {
  return <FeatureFlagsContext.Provider value={flags}>{children}</FeatureFlagsContext.Provider>;
}

// Every flag
export function useFeatureFlags(): FeatureFlags {
  return useContext(FeatureFlagsContext);
}

// True only when the flag is on
export function useFeatureFlag(key: FeatureFlagKey): boolean {
  return useContext(FeatureFlagsContext)[key] === true;
}
