"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SourceIcon } from "@/components/icons";
import { EmptyState } from "@/components/EmptyState";

// =====================================================================
// RIGHT PANEL: shows the sources and units behind whatever is open.
// The shell owns the panel; a page fills it by rendering <RightPanelSlot>
// anywhere in its tree, which portals its children into the panel.
// =====================================================================

const RightPanelTargetContext = createContext<HTMLElement | null>(null);
const SetRightPanelTargetContext = createContext<(el: HTMLElement | null) => void>(() => {});

// PROVIDER: holds the panel's DOM node once it mounts
export function RightPanelProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  return (
    <SetRightPanelTargetContext.Provider value={setTarget}>
      <RightPanelTargetContext.Provider value={target}>{children}</RightPanelTargetContext.Provider>
    </SetRightPanelTargetContext.Provider>
  );
}

// PANEL: the aside itself; shows an empty state until a page puts something in the slot
export function RightPanel() {
  const setTarget = useContext(SetRightPanelTargetContext);
  return (
    <aside aria-label="Details" className="hidden w-72 shrink-0 flex-col overflow-y-auto border-l bg-sidebar lg:flex">
      {/* `peer` + `peer-empty` swap the placeholder in when no page fills the slot */}
      <div ref={setTarget} className="peer flex flex-col gap-3 p-3" />
      <EmptyState icon={SourceIcon} title="Select something to see its sources" className="hidden peer-empty:flex" />
    </aside>
  );
}

// SLOT: what a page renders to fill the right panel
export function RightPanelSlot({ children }: { children: ReactNode }) {
  const target = useContext(RightPanelTargetContext);
  if (!target) return null;
  return createPortal(children, target);
}
