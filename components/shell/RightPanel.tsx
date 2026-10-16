"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ErrorBoundary } from "@/components/error";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { XIcon } from "lucide-react";
import { Tooltip } from "@/components/standard/tooltip";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";

// =====================================================================
// RIGHT PANEL: shows the sources and units behind whatever is open.
// The shell owns the panel; a page fills it by rendering <RightPanelSlot>
// anywhere in its tree, which portals its children into the panel.
// The panel stays collapsed until a slot is mounted, then slides open.
// On a phone the same content opens as a bottom sheet from the top bar.
// =====================================================================

const RightPanelTargetContext = createContext<HTMLElement | null>(null);
const SetRightPanelTargetContext = createContext<(el: HTMLElement | null) => void>(() => {});
const RightPanelOpenContext = createContext(false);
const CloseSlotContext = createContext<(() => void) | null>(null);
const RegisterSlotContext = createContext<() => () => void>(() => () => {});
const MobileSheetContext = createContext<{ isSheetOpen: boolean; setSheetOpen: (open: boolean) => void }>({
  isSheetOpen: false,
  setSheetOpen: () => {},
});

// PROVIDER: holds the panel's DOM node once it mounts, and how many slots are filling it
export function RightPanelProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [slotCount, setSlotCount] = useState(0);
  const [isSheetOpen, setSheetOpen] = useState(false);
  const registerSlot = useCallback(() => {
    setSlotCount((n) => n + 1);
    return () => setSlotCount((n) => n - 1);
  }, []);
  return (
    <SetRightPanelTargetContext.Provider value={setTarget}>
      <RegisterSlotContext.Provider value={registerSlot}>
        <RightPanelOpenContext.Provider value={slotCount > 0}>
          <MobileSheetContext.Provider value={{ isSheetOpen, setSheetOpen }}>
            <RightPanelTargetContext.Provider value={target}>{children}</RightPanelTargetContext.Provider>
          </MobileSheetContext.Provider>
        </RightPanelOpenContext.Provider>
      </RegisterSlotContext.Provider>
    </SetRightPanelTargetContext.Provider>
  );
}

// RIGHT PANEL STATE: whether a page filled the panel, and the phone sheet's open state
export function useRightPanel() {
  const hasContent = useContext(RightPanelOpenContext);
  const { isSheetOpen, setSheetOpen } = useContext(MobileSheetContext);
  return { hasContent, isSheetOpen, setSheetOpen };
}

// PANEL: a phone gets the bottom sheet, wider screens the aside; never both, so the slot has one target
export function RightPanel() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileDetailsSheet /> : <DesktopPanel />;
}

// DESKTOP PANEL: the aside itself; collapsed to zero width until a page puts something in the slot
function DesktopPanel() {
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

// PHONE SHEET: the same panel content, sliding up from the bottom when the top bar's details button is tapped
function MobileDetailsSheet() {
  const setTarget = useContext(SetRightPanelTargetContext);
  const { isSheetOpen, setSheetOpen } = useRightPanel();
  return (
    <Sheet open={isSheetOpen} onOpenChange={setSheetOpen}>
      <SheetContent side="bottom" className="max-h-[80dvh]">
        <SheetHeader>
          <SheetTitle>Details</SheetTitle>
          <SheetDescription className="sr-only">Sources and units behind this page.</SheetDescription>
        </SheetHeader>
        <div ref={setTarget} className="flex flex-col gap-3 overflow-y-auto px-3 pb-6" />
      </SheetContent>
    </Sheet>
  );
}

// SLOT: what a page renders to fill the right panel; a crash in it stays inside the panel.
// A panel opened by a click (a line, a definition) passes onClose, which its header's X calls.
export function RightPanelSlot({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  const target = useContext(RightPanelTargetContext);
  const registerSlot = useContext(RegisterSlotContext);
  useEffect(() => registerSlot(), [registerSlot]);
  if (!target) return null;
  return createPortal(<CloseSlotContext.Provider value={onClose ?? null}><ErrorBoundary where="The side panel">{children}</ErrorBoundary></CloseSlotContext.Provider>, target);
}

// CLOSE BUTTON for a panel header; renders nothing when the slot has no onClose
export function RightPanelClose() {
  const close = useContext(CloseSlotContext);
  if (!close) return null;
  return (
    <Tooltip content="Close">
      <Button type="button" size="icon-xs" variant="ghost" className="-mr-1.5" aria-label="Close panel" onClick={close}>
        <XIcon />
      </Button>
    </Tooltip>
  );
}
