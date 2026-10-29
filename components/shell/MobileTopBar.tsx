"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { InfoIcon } from "@/components/icons";
import { ModuleHelp } from "@/components/tutorial/ModuleHelp";
import { useSidebar } from "@/components/ui/sidebar";
import type { ModuleFlagKey } from "@/lib/flags/registry";
import { isActivePath, NAV_GROUPS, SETTINGS_NAV, visibleNavItems } from "./nav";
import { useRightPanel } from "./RightPanel";

// =====================================================================
// MOBILE TOP BAR: phones only (hidden from 768px up, so desktop never renders it).
// The side bars don't fit beside the page on a phone, so this bar opens them:
// the menu button opens the app drawer (links + pages tree), the details button
// opens the right panel as a bottom sheet when the page has filled it.
// =====================================================================

const ALL_NAV = [...NAV_GROUPS.flatMap((group) => group.items), SETTINGS_NAV];
const APP_NAME = "Corpus Wiki";

// SCREEN TITLE: the nav label of the section the current route belongs to; a module that is off has no title
function useScreenTitle(modules: readonly ModuleFlagKey[]): string {
  const pathname = usePathname();
  return visibleNavItems(ALL_NAV, { admin: true, modules }).find((item) => isActivePath(item.href, pathname))?.label ?? APP_NAME;
}

// CLOSE ON NAVIGATE: a tap on a link in either drawer should land on the new page, not leave the drawer over it
function useCloseDrawersOnNavigate() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const { setSheetOpen } = useRightPanel();
  useEffect(() => {
    setOpenMobile(false);
    setSheetOpen(false);
  }, [pathname, setOpenMobile, setSheetOpen]);
}

// TOP BAR: menu | title | tutorial | details. `modules`: the modules that are on
export function MobileTopBar({ modules = [] }: { modules?: readonly ModuleFlagKey[] }) {
  const title = useScreenTitle(modules);
  const { setOpenMobile } = useSidebar();
  const { hasContent, setSheetOpen } = useRightPanel();
  useCloseDrawersOnNavigate();
  return (
    <header className="sticky top-0 z-20 flex h-11 items-center gap-2 border-b bg-background/95 px-2 backdrop-blur md:hidden">
      <TopBarButton label="Open menu" onClick={() => setOpenMobile(true)}>
        <Menu className="size-4" />
      </TopBarButton>
      <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h1>
      <ModuleHelp />
      {hasContent ? (
        <TopBarButton label="Open details" onClick={() => setSheetOpen(true)}>
          <InfoIcon />
        </TopBarButton>
      ) : null}
    </header>
  );
}

// TOP BAR BUTTON: a 44px touch target around a 16px icon
function TopBarButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="flex size-11 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground">
      {children}
    </button>
  );
}
