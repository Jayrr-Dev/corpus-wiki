"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useExceptionCounts } from "@/app/(app)/exceptions/useExceptionInbox";
import { HelpIcon, SignOutIcon } from "@/components/icons";
import { reopenTutorial } from "@/components/tutorial";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { signOut } from "@/lib/auth/actions";
import { MobileSidebarTree } from "./SidebarTree";
import { isActivePath, type NavItem, PRIMARY_NAV, SECONDARY_NAV, SETTINGS_NAV } from "./nav";

// OPEN EXCEPTION COUNT: the one "needs you" number on every screen
function useOpenExceptionCount(): number {
  const { data } = useExceptionCounts();
  return data?.open ?? 0;
}

// NAV LINK: one menu row; the tooltip only shows when the sidebar is collapsed to icons
function NavLink({ item, badge }: { item: NavItem; badge?: number }) {
  const pathname = usePathname();
  const Icon = item.icon;
  const isActive = isActivePath(item.href, pathname);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
        <Link
          href={item.href}
          data-tour={`nav-${item.label.toLowerCase()}`}
          aria-current={isActive ? "page" : undefined}
        >
          <Icon />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
      {badge ? <SidebarMenuBadge tone="attention">{badge}</SidebarMenuBadge> : null}
    </SidebarMenuItem>
  );
}

// NAV GROUP: a run of links with no title; groups are split by a hairline only
function NavGroup({ items, separator, badges }: { items: readonly NavItem[]; separator?: boolean; badges?: Record<string, number> }) {
  return (
    <SidebarGroup separator={separator}>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => <NavLink key={item.href} item={item} badge={badges?.[item.href]} />)}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

// APP SIDEBAR: brand and search, the two nav groups, then settings / tutorial / sign out
// On a phone it is a drawer opened from the top bar, with the pages tree or filters under the links
export function AppSidebar() {
  const openCount = useOpenExceptionCount();
  const { isMobile } = useSidebar();
  return (
    <Sidebar variant="inset" collapsible="icon" collapseThumb collapseThumbSize="xs">
      <SidebarHeader search searchPlaceholder="Search…" separator>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Second Brain">
              <Link href="/">
                <PageIconMark />
                <span className="font-semibold">Second Brain</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup items={PRIMARY_NAV} badges={{ "/decisions": openCount, "/exceptions": openCount }} />
        <NavGroup items={SECONDARY_NAV} separator />
        {/* phones have no room for the pages tree beside the page, so the drawer carries it */}
        {isMobile ? <MobileSidebarTree /> : null}
      </SidebarContent>
      <SidebarFooter separator>
        <SidebarMenu>
          <NavLink item={SETTINGS_NAV} />
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Tutorial" onClick={reopenTutorial}>
              <HelpIcon />
              <span>Tutorial</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <form action={signOut}>
              <SidebarMenuButton type="submit" tooltip="Sign out">
                <SignOutIcon />
                <span>Sign out</span>
              </SidebarMenuButton>
            </form>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

// BRAND MARK: a small filled square standing in for a logo
function PageIconMark() {
  return <span aria-hidden className="size-4 shrink-0 rounded-sm bg-text" />;
}
