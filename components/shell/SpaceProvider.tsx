"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Space } from "@/lib/spaces/shared";

const SpaceContext = createContext<Space | null>(null);

export function SpaceProvider({ space, children }: { space: Space; children: ReactNode }) {
  return <SpaceContext.Provider value={space}>{children}</SpaceContext.Provider>;
}

export function useActiveSpace(): Space {
  const space = useContext(SpaceContext);
  if (!space) throw new Error("Active space is unavailable.");
  return space;
}
