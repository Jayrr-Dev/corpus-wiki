"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useOpenExceptionCount } from "@/app/(app)/exceptions/useExceptionInbox";
import { BrandMark, BrandName } from "@/components/brand/BrandMark";
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
import { ERROR_LOG_NAV, isActivePath, NAV_GROUPS, type NavItem, SETTINGS_NAV } from "./nav";
import { SpaceSwitcher } from "./SpaceSwitcher";
import { ThemeSwitch } from "./ThemeSwitch";
import type { Space } from "@/lib/spaces/shared";
import { Tooltip } from "@/components/standard/tooltip";
import { cn } from "@/lib/utils";
import { type NavMode, setNavMode, useNavMode } from "./useNavMode";

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

// NAV MODE SWITCH: Admin shows every module, User only the reading places; hidden when collapsed to icons
function NavModeSwitch() {
  const mode = useNavMode();
  const options: { value: NavMode; label: string; hint: string }[] = [
    { value: "admin", label: "Admin", hint: "Show every module" },
    { value: "user", label: "User", hint: "Show only what a regular user needs" },
  ];
  return (
    <div role="radiogroup" aria-label="Sidebar mode" className="ml-auto flex shrink-0 rounded-md border bg-background p-px text-[11px] leading-4 group-data-[collapsible=icon]:hidden">
      {options.map((option) => (
        <Tooltip key={option.value} content={option.hint}>
          <button
            type="button"
            role="radio"
            aria-checked={mode === option.value}
            onClick={() => setNavMode(option.value)}
            className={cn("rounded px-1 text-muted-foreground hover:text-foreground", mode === option.value && "bg-accent font-medium text-foreground")}
          >
            {option.label}
          </button>
        </Tooltip>
      ))}
    </div>
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
  const isAdmin = useNavMode() === "admin";
  const visible = (items: readonly NavItem[]) => (isAdmin ? items : items.filter((item) => !item.admin));
  const badges = { "/units": suggestionCount ?? 0, "/decisions": openCount, "/exceptions": openCount, "/sources": unfinishedSources };
  return (
    <Sidebar variant="inset" collapsible="icon" collapseThumb collapseThumbSize="xs">
      <SidebarHeader search searchPlaceholder="Search…" separator>
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center">
            <SidebarMenuButton asChild tooltip="Corpus Wiki" className="min-w-0 flex-1 pr-1">
              <Link href="/">
                <BrandMark />
                <BrandName className="text-body" />
              </Link>
            </SidebarMenuButton>
            <NavModeSwitch />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SpaceSwitcher spaces={spaces} activeSpace={activeSpace} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {NAV_GROUPS.map(visible).filter((items) => items.length > 0).map((items, index) => (
          <NavGroup key={items[0]!.href} items={items} separator={index > 0} badges={badges} />
        ))}
        {/* phones have no room for the pages tree beside the page, so the drawer carries it */}
        {isMobile ? <MobileSidebarTree /> : null}
      </SidebarContent>
      <SidebarFooter separator>
        {accountEmail ? <Tooltip content={accountEmail}><p className="truncate px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">{accountEmail}</p></Tooltip> : null}
        <SidebarMenu>
          {isAdmin ? <NavLink item={ERROR_LOG_NAV} /> : null}
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
