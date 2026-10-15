import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { PendingStaleRefresh } from "@/components/living-page/PendingStaleRefresh";
import { AppShell } from "@/components/shell";

// SIGNED-IN AREA: every page here sits inside the shell (the proxy guards sign-in)
export default async function AppLayout({ children }: { children: ReactNode }) {
  // the sidebar remembers expanded/collapsed in a cookie
  const sidebarOpen = (await cookies()).get("sidebar_state")?.value !== "false";
  return (
    <AppShell defaultOpen={sidebarOpen}>
      <PendingStaleRefresh />
      {children}
    </AppShell>
  );
}
