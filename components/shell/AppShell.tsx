import type { ReactNode } from "react";
import { Tutorial } from "@/components/tutorial";
import { ModuleHelp } from "@/components/tutorial/ModuleHelp";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { MobileTopBar } from "./MobileTopBar";
import { RightPanel, RightPanelProvider } from "./RightPanel";
import { SidebarTree } from "./SidebarTree";

// APP SHELL: app sidebar | inset (context tree | reading pane | right panel); no top header bar
// on desktop; the module tutorial button sits in the page's top-right corner. Phones get a slim top bar instead that opens the sidebars as drawers.
// `defaultOpen` comes from the sidebar_state cookie (read in the layout) so the first paint matches
export function AppShell({ children, defaultOpen = true }: { children: ReactNode; defaultOpen?: boolean }) {
  return (
    <RightPanelProvider>
      <SidebarProvider defaultOpen={defaultOpen} className="h-dvh min-h-0 overflow-hidden">
        <AppSidebar />
        <SidebarInset className="min-h-0 flex-row overflow-hidden">
          <SidebarTree />
          <div className="relative flex min-w-0 flex-1">
            <main className="min-w-0 flex-1 overflow-y-auto">
              <MobileTopBar />
              {children}
            </main>
            <div className="absolute top-2 right-3 z-10 hidden md:block"><ModuleHelp /></div>
          </div>
          <RightPanel />
        </SidebarInset>
      </SidebarProvider>
      <Tutorial />
    </RightPanelProvider>
  );
}
