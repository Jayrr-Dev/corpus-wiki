import type { ReactNode } from "react";
import { TutorialCard } from "@/components/tutorial";
import { Ribbon } from "./Ribbon";
import { RightPanel, RightPanelProvider } from "./RightPanel";
import { SidebarTree } from "./SidebarTree";

// APP SHELL (Obsidian-like): ribbon | sidebar | reading pane | right panel
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <RightPanelProvider>
      <div className="flex h-dvh overflow-hidden bg-background text-text">
        <Ribbon />
        <aside aria-label="Navigation" className="hidden w-60 shrink-0 overflow-y-auto border-r bg-sidebar md:block">
          <SidebarTree />
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
        <RightPanel />
      </div>
      <TutorialCard />
    </RightPanelProvider>
  );
}
