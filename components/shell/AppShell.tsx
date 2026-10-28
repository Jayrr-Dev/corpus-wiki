import type { ReactNode } from "react";
import { RoutedErrorBoundary } from "@/components/error";
import { Tutorial } from "@/components/tutorial";
import { ModuleHelp } from "@/components/tutorial/ModuleHelp";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { MobileTopBar } from "./MobileTopBar";
import { RightPanel, RightPanelProvider } from "./RightPanel";
import { SidebarTree } from "./SidebarTree";
import type { Space } from "@/lib/spaces/shared";

// APP SHELL: app sidebar | inset (context tree | reading pane | right panel); no top header bar
// on desktop; the module tutorial button sits in the page's top-right corner. Phones get a slim top bar instead that opens the sidebars as drawers.
// `defaultOpen` comes from the sidebar_state cookie (read in the layout) so the first paint matches
export function AppShell({ children, defaultOpen = true, spaces, activeSpace, accountEmail }: { children: ReactNode; defaultOpen?: boolean; spaces: Space[]; activeSpace: Space; accountEmail?: string | null }) {
  return (
    <RightPanelProvider>
      <SidebarProvider defaultOpen={defaultOpen} className="h-dvh min-h-0 overflow-hidden">
        <RoutedErrorBoundary where="The sidebar">
          <AppSidebar spaces={spaces} activeSpace={activeSpace} accountEmail={accountEmail} />
        </RoutedErrorBoundary>
        <SidebarInset className="min-h-0 flex-row overflow-hidden">
          <RoutedErrorBoundary where="The page list">
            <SidebarTree />
          </RoutedErrorBoundary>
          <div className="relative flex min-w-0 flex-1">
            <main className="min-w-0 flex-1 overflow-y-auto">
              <RoutedErrorBoundary where="The top bar">
                <MobileTopBar />
              </RoutedErrorBoundary>
              {children}
            </main>
            <div className="absolute top-2 right-3 z-10 hidden md:block">
              <RoutedErrorBoundary where="Page help">
                <ModuleHelp />
              </RoutedErrorBoundary>
            </div>
          </div>
          <RoutedErrorBoundary where="The side panel">
            <RightPanel />
          </RoutedErrorBoundary>
        </SidebarInset>
      </SidebarProvider>
      <RoutedErrorBoundary where="The tutorial">
        <Tutorial />
      </RoutedErrorBoundary>
    </RightPanelProvider>
  );
}
