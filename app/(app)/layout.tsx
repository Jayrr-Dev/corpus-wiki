import type { ReactNode } from "react";
import { PendingStaleRefresh } from "@/components/living-page/PendingStaleRefresh";
import { AppShell } from "@/components/shell";

// SIGNED-IN AREA: every page here sits inside the shell (the proxy guards sign-in)
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <PendingStaleRefresh />
      {children}
    </AppShell>
  );
}
