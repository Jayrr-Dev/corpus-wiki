import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { PendingStaleRefresh } from "@/components/living-page/PendingStaleRefresh";
import { ExceptionNotifications } from "@/components/toast/ExceptionNotifications";
import { AppShell } from "@/components/shell";
import { TimeZoneProvider } from "@/app/(app)/_components/DateTime";
import { isTimeZone, TIME_ZONE_COOKIE } from "@/app/(app)/_lib/format";

// SIGNED-IN AREA: every page here sits inside the shell (the proxy guards sign-in)
export default async function AppLayout({ children }: { children: ReactNode }) {
  // the sidebar remembers expanded/collapsed in a cookie
  const cookieStore = await cookies();
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";
  // dates and times show in the zone picked in Settings
  const zone = cookieStore.get(TIME_ZONE_COOKIE)?.value;
  const timeZone = zone && isTimeZone(zone) ? zone : null;
  return (
    <TimeZoneProvider timeZone={timeZone}>
      <AppShell defaultOpen={sidebarOpen}>
        <PendingStaleRefresh />
        <ExceptionNotifications />
        {children}
      </AppShell>
    </TimeZoneProvider>
  );
}
