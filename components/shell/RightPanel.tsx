"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ErrorBoundary } from "@/components/error";

// =====================================================================
// RIGHT PANEL: shows the sources and units behind whatever is open.
// The shell owns the panel; a page fills it by rendering <RightPanelSlot>
// anywhere in its tree, which portals its children into the panel.
// The panel stays collapsed until a slot is mounted, then slides open.
// =====================================================================

const RightPanelTargetContext = createContext<HTMLElement | null>(null);
const SetRightPanelTargetContext = createContext<(el: HTMLElement | null) => void>(() => {});
const RightPanelOpenContext = createContext(false);
const RegisterSlotContext = createContext<() => () => void>(() => () => {});

// PROVIDER: holds the panel's DOM node once it mounts, and how many slots are filling it
export function RightPanelProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [slotCount, setSlotCount] = useState(0);
  const registerSlot = useCallback(() => {
    setSlotCount((n) => n + 1);
    return () => setSlotCount((n) => n - 1);
  }, []);
  return (
    <SetRightPanelTargetContext.Provider value={setTarget}>
      <RegisterSlotContext.Provider value={registerSlot}>
        <RightPanelOpenContext.Provider value={slotCount > 0}>
          <RightPanelTargetContext.Provider value={target}>{children}</RightPanelTargetContext.Provider>
        </RightPanelOpenContext.Provider>
      </RegisterSlotContext.Provider>
    </SetRightPanelTargetContext.Provider>
  );
}

// PANEL: the aside itself; collapsed to zero width until a page puts something in the slot
export function RightPanel() {
  const setTarget = useContext(SetRightPanelTargetContext);
  const open = useContext(RightPanelOpenContext);
  return (
    <aside
      aria-label="Details"
      aria-hidden={!open}
      className={`hidden shrink-0 overflow-hidden bg-sidebar transition-[width,border-color] duration-300 ease-out motion-reduce:transition-none lg:flex ${
        open ? "w-72 border-l" : "w-0 border-l border-transparent"
      }`}
    >
      {/* fixed inner width so content doesn't reflow while the panel animates */}
      <div ref={setTarget} className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto p-3" />
    </aside>
  );
}

// SLOT: what a page renders to fill the right panel; a crash in it stays inside the panel
export function RightPanelSlot({ children }: { children: ReactNode }) {
  const target = useContext(RightPanelTargetContext);
  const registerSlot = useContext(RegisterSlotContext);
  useEffect(() => registerSlot(), [registerSlot]);
  if (!target) return null;
  return createPortal(<ErrorBoundary where="The side panel">{children}</ErrorBoundary>, target);
}
