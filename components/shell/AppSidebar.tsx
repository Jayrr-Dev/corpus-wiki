"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useOpenExceptionCount } from "@/app/(app)/exceptions/useExceptionInbox";
import { BrandMark } from "@/components/brand/BrandMark";
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
import { useUnfinishedSources } from "@/components/upload/useUnfinishedSources";
import { useSuggestionAttentionCount } from "./useSuggestionAttentionCount";
import { signOut } from "@/lib/auth/actions";
import { MobileSidebarTree } from "./SidebarTree";
import { ERROR_LOG_NAV, isActivePath, type NavItem, PRIMARY_NAV, SECONDARY_NAV, SETTINGS_NAV } from "./nav";
import { SpaceSwitcher } from "./SpaceSwitcher";
import { ThemeSwitch } from "./ThemeSwitch";
import type { Space } from "@/lib/spaces/shared";
import { Tooltip } from "@/components/standard/tooltip";

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

// APP SIDEBAR: brand and search, the two nav groups, then error log / settings / theme / tutorial / sign out
// On a phone it is a drawer opened from the top bar, with the pages tree or filters under the links
export function AppSidebar({ spaces, activeSpace, accountEmail }: { spaces: Space[]; activeSpace: Space; accountEmail?: string | null }) {
  // OPEN EXCEPTION COUNT: the one "needs you" number on every screen
  const openCount = useOpenExceptionCount();
  const suggestionCount = useSuggestionAttentionCount();
  const unfinishedSources = useUnfinishedSources().size;
  const { isMobile } = useSidebar();
  return (
    <Sidebar variant="inset" collapsible="icon" collapseThumb collapseThumbSize="xs">
      <SidebarHeader search searchPlaceholder="Search…" separator>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Corpus Wiki">
              <Link href="/">
                <BrandMark />
                <span className="font-semibold">Corpus Wiki</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SpaceSwitcher spaces={spaces} activeSpace={activeSpace} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup items={PRIMARY_NAV} badges={{ "/units": suggestionCount ?? 0, "/decisions": openCount, "/exceptions": openCount }} />
        <NavGroup items={SECONDARY_NAV} separator badges={{ "/sources": unfinishedSources }} />
        {/* phones have no room for the pages tree beside the page, so the drawer carries it */}
        {isMobile ? <MobileSidebarTree /> : null}
      </SidebarContent>
      <SidebarFooter separator>
        {accountEmail ? <Tooltip content={accountEmail}><p className="truncate px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">{accountEmail}</p></Tooltip> : null}
        <SidebarMenu>
          <NavLink item={ERROR_LOG_NAV} />
          <NavLink item={SETTINGS_NAV} />
          <ThemeSwitch />
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
