"use client";

import Link from "next/link";
import { useState } from "react";
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
  SidebarGroupLabel,
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
import { isActivePath, type NavItem, SETTINGS_NAV, visibleNavGroups } from "./nav";
import { SidebarBackdrop } from "./SidebarBackdrop";
import { SpaceSwitcher } from "./SpaceSwitcher";
import { ThemeSwitch } from "./ThemeSwitch";
import type { ModuleFlagKey } from "@/lib/flags/registry";
import { useFeatureFlag } from "@/lib/flags/client";
import type { Space } from "@/lib/spaces/shared";
import { Tooltip } from "@/components/standard/tooltip";
import { cn } from "@/lib/utils";
import { type NavMode, setNavMode, useNavMode } from "./useNavMode";

// The signed-in person, as the sidebar shows them
export type SidebarAccount = { email: string | null; name?: string | null; avatarUrl?: string | null };

// The same four marks the Pages panels use: square, circle, diamond, triangle
const AVATAR_SHAPES = {
  square: <rect x="3" y="3" width="10" height="10" rx="1" />,
  circle: <circle cx="8" cy="8" r="5" />,
  diamond: <path d="m8 1.5 6.5 6.5L8 14.5 1.5 8Z" />,
  triangle: <path d="m8 2 6 11H2Z" />,
} as const;
type AvatarShape = keyof typeof AVATAR_SHAPES;

// A random shape that stays the same for each person, picked from their email (or name)
function avatarShape({ name, email }: SidebarAccount): AvatarShape {
  const key = email ?? name ?? "";
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const shapes = Object.keys(AVATAR_SHAPES) as AvatarShape[];
  return shapes[hash % shapes.length]!;
}

// AVATAR: the account picture, or a shape when there is none or it fails to load
function AccountAvatar({ account }: { account: SidebarAccount }) {
  const [broken, setBroken] = useState(false);
  if (account.avatarUrl && !broken) {
    // eslint-disable-next-line @next/next/no-img-element -- a remote picture (e.g. Google), not a local asset
    return <img src={account.avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-8 shrink-0 rounded-full object-cover" />;
  }
  return (
    <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-sidebar-accent ring-1 ring-sidebar-border text-sidebar-foreground">
      <svg viewBox="0 0 16 16" className="size-4" fill="currentColor">{AVATAR_SHAPES[avatarShape(account)]}</svg>
    </span>
  );
}

// ACCOUNT ROW: avatar, name and email; opens Settings. The Admin / User switch sits in the card, far right of the name.
// The switch can't nest in the link, so it floats over it and the card stays lit while it's hovered.
// Collapsed, the avatar alone stays.
function AccountRow({ account, modeSwitch }: { account: SidebarAccount; modeSwitch?: boolean }) {
  const label = account.name ?? account.email ?? "Account";
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild size="lg" tooltip={label} className={cn(modeSwitch && "group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-accent-foreground")}>
        <Link href={SETTINGS_NAV.href}>
          <AccountAvatar account={account} />
          <span className="grid min-w-0 flex-1 leading-tight">
            <span className={cn("truncate font-medium", modeSwitch && "pr-22")}>{label}</span>
            {account.name && account.email ? <span className="truncate text-xs text-muted-foreground">{account.email}</span> : null}
          </span>
        </Link>
      </SidebarMenuButton>
      {modeSwitch ? <NavModeSwitch /> : null}
    </SidebarMenuItem>
  );
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

// NAV MODE SWITCH: Admin shows every module, User only the reading places; hidden when collapsed to icons
function NavModeSwitch() {
  const mode = useNavMode();
  const options: { value: NavMode; label: string; hint: string }[] = [
    { value: "admin", label: "Admin", hint: "Show every module" },
    { value: "user", label: "User", hint: "Show only what a regular user needs" },
  ];
  return (
    <div role="radiogroup" aria-label="Sidebar mode" className="absolute right-2 top-1.5 flex rounded-md border bg-background p-px text-xs leading-4 group-data-[collapsible=icon]:hidden">
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

// NAV GROUP: a run of links under a small title; with `separator`, a faint line with the title centered on it
// Collapsed (icon rail): no title, just a short line where the title's line was, so nothing moves up or down
function NavGroup({ title, items, separator, badges }: { title: string; items: readonly NavItem[]; separator?: boolean; badges?: Record<string, number> }) {
  return (
    <SidebarGroup separator={separator} className={separator ? "pt-0 before:hidden group-data-[collapsible=icon]:before:block group-data-[collapsible=icon]:before:top-2.5" : undefined}>
      <SidebarGroupLabel
        className={cn(
          "relative h-5 [font-variant-caps:all-small-caps] tracking-wide",
          separator && "before:absolute before:inset-x-0 before:top-1/2 before:h-px before:bg-sidebar-border/50 before:content-[''] group-data-[collapsible=icon]:before:hidden"
        )}
      >
        {separator ? (
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-sidebar px-2 group-data-[collapsible=icon]:hidden">{title}</span>
        ) : (
          title
        )}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => <NavLink key={item.href} item={item} badge={badges?.[item.href]} />)}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

// APP SIDEBAR: brand and search, the two nav groups, then error log / settings / theme / tutorial / sign out
// On a phone it is a drawer opened from the top bar, with the pages tree or filters under the links.
// `modules`: the modules that are on; links to the others are hidden
export function AppSidebar({ spaces, activeSpace, account, modules = [] }: { spaces: Space[]; activeSpace: Space; account?: SidebarAccount; modules?: readonly ModuleFlagKey[] }) {
  // OPEN EXCEPTION COUNT: the one "needs you" number on every screen
  const openCount = useOpenExceptionCount();
  const suggestionCount = useSuggestionAttentionCount();
  const unfinishedSources = useUnfinishedSources().size;
  const { isMobile } = useSidebar();
  // with the Admin / User switch turned off in Settings, the sidebar shows every module that is on
  const hasModeSwitch = modules.includes("nav_mode_switch");
  const isAdmin = useNavMode() === "admin" || !hasModeSwitch;
  // the Tutorial link is behind the "tutorial_button" feature flag (off by default)
  const showTutorial = useFeatureFlag("tutorial_button");
  const badges = { "/units": suggestionCount ?? 0, "/decisions": openCount, "/exceptions": openCount, "/sources": unfinishedSources };
  return (
    <Sidebar variant="inset" collapsible="icon" collapseThumb collapseThumbSize="xs">
      <SidebarBackdrop />
      <SidebarHeader search searchPlaceholder="Search…">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Corpus Wiki">
              <Link href="/pages">
                <BrandMark />
                <BrandName className="text-body" />
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SpaceSwitcher spaces={spaces} activeSpace={activeSpace} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {visibleNavGroups({ admin: isAdmin, modules }).map((group) => (
          <NavGroup key={group.title} title={group.title} items={group.items} separator badges={badges} />
        ))}
        {/* phones have no room for the pages tree beside the page, so the drawer carries it */}
        {isMobile ? <MobileSidebarTree /> : null}
      </SidebarContent>
      <SidebarFooter separator>
        <SidebarMenu>
          {account ? <AccountRow account={account} modeSwitch={hasModeSwitch} /> : null}
          {showTutorial ? (
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Tutorial" onClick={reopenTutorial}>
                <HelpIcon />
                <span>Tutorial</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
          <SidebarMenuItem>
            <div className="flex items-center gap-1">
              <form action={signOut} className="min-w-0 flex-1">
                <SidebarMenuButton type="submit" tooltip="Sign out">
                  <SignOutIcon />
                  <span>Sign out</span>
                </SidebarMenuButton>
              </form>
              <ThemeSwitch />
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
