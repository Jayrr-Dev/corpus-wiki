import type { ReactNode } from "react";
import { Tutorial } from "@/components/tutorial";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { RightPanel, RightPanelProvider } from "./RightPanel";
import { SidebarTree } from "./SidebarTree";

// APP SHELL: app sidebar | inset (context tree | reading pane | right panel); no top header bar
// `defaultOpen` comes from the sidebar_state cookie (read in the layout) so the first paint matches
export function AppShell({ children, defaultOpen = true }: { children: ReactNode; defaultOpen?: boolean }) {
  return (
    <RightPanelProvider>
      <SidebarProvider defaultOpen={defaultOpen} className="h-dvh min-h-0 overflow-hidden">
        <AppSidebar />
        <SidebarInset className="min-h-0 flex-row overflow-hidden">
          <SidebarTree />
          <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
          <RightPanel />
        </SidebarInset>
      </SidebarProvider>
      <Tutorial />
    </RightPanelProvider>
  );
}
