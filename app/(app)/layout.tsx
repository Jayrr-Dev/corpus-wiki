import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { RoutedErrorBoundary } from "@/components/error";
import { BrowserErrorReporter } from "@/components/error/BrowserErrorReporter";
import { ExceptionNotifications } from "@/components/toast/ExceptionNotifications";
import { SuggestionProgress } from "@/components/toast/SuggestionProgress";
import { AppShell } from "@/components/shell";
import { TimeZoneProvider } from "@/app/(app)/_components/DateTime";
import { isTimeZone, TIME_ZONE_COOKIE } from "@/app/(app)/_lib/format";
import { readMySpaces } from "@/lib/spaces/server";
import { AccountDataProvider } from "@/components/shell/AccountDataProvider";
import { SpaceProvider } from "@/components/shell/SpaceProvider";

// SIGNED-IN AREA: every page here sits inside the shell (the proxy guards sign-in)
export default async function AppLayout({ children }: { children: ReactNode }) {
  // the sidebar remembers expanded/collapsed in a cookie
  const cookieStore = await cookies();
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";
  // dates and times show in the zone picked in Settings
  const zone = cookieStore.get(TIME_ZONE_COOKIE)?.value;
  const timeZone = zone && isTimeZone(zone) ? zone : null;
  const { spaces, activeSpace, account } = await readMySpaces();
  if (!activeSpace.owner_id) throw new Error("This space has no account owner.");
  return (
    <AccountDataProvider key={activeSpace.id} accountId={account.id}>
      <SpaceProvider space={activeSpace}>
        <TimeZoneProvider timeZone={timeZone}>
          <AppShell defaultOpen={sidebarOpen} spaces={spaces} activeSpace={activeSpace} accountEmail={account.email}>
            <RoutedErrorBoundary where="Open questions">
              <ExceptionNotifications />
            </RoutedErrorBoundary>
            <RoutedErrorBoundary where="Suggestion progress">
              <SuggestionProgress />
            </RoutedErrorBoundary>
            <BrowserErrorReporter />
            {children}
          </AppShell>
        </TimeZoneProvider>
      </SpaceProvider>
    </AccountDataProvider>
  );
}
