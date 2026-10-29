import type { ComponentType } from "react";
import { BookOpen, Bot, Clapperboard, FileCode, GraduationCap, Images, MessageCircle, Users } from "lucide-react";
import {
  ChangeIcon,
  DecisionIcon,
  DomainIcon,
  EntityIcon,
  ErrorLogIcon,
  ExceptionIcon,
  GraphIcon,
  type IconProps,
  PageIcon,
  SettingsIcon,
  SkillIcon,
  SourceIcon,
  UnitIcon,
  UploadIcon,
} from "@/components/icons";
import type { ModuleFlagKey } from "@/lib/flags/registry";

// `admin`: shown only in Admin mode (the sidebar's Admin / User switch)
// `module`: shown only while that module is on (Settings → Features → Sidebar)
export type NavItem = { label: string; href: string; icon: ComponentType<IconProps>; admin?: boolean; module?: ModuleFlagKey };

// `title`: the small caps label shown above the group
export type NavGroup = { title: string; items: readonly NavItem[] };

// THE ERROR LOG: shown under Exceptions, behind its module switch
export const ERROR_LOG_NAV: NavItem = { label: "Error log", href: "/errors", icon: ErrorLogIcon, admin: true, module: "error_log" };

// SIDEBAR GROUPS: one kind of job each, split by a hairline
export const NAV_GROUPS: readonly NavGroup[] = [
  // bring material in
  {
    title: "Bring in",
    items: [
      { label: "Upload", href: "/upload", icon: UploadIcon, module: "upload" },
      { label: "Sources", href: "/sources", icon: SourceIcon, admin: true, module: "sources" },
      { label: "Assets", href: "/assets", icon: Images, admin: true, module: "assets" },
    ],
  },
  // turn knowledge into something else: the wiki, practice, video, docs (each behind its own switch)
  {
    title: "Transform",
    items: [
      { label: "Wiki", href: "/pages", icon: PageIcon, module: "pages" },
      { label: "Glossary", href: "/glossary", icon: BookOpen, module: "glossary" },
      { label: "Study", href: "/study", icon: GraduationCap, module: "study" },
      { label: "Video", href: "/video", icon: Clapperboard, module: "video" },
      { label: "Docs", href: "/docs", icon: FileCode, module: "docs" },
    ],
  },
  // analysis: read and ask
  {
    title: "Analyze",
    items: [
      { label: "Graph", href: "/graph", icon: GraphIcon, module: "graph" },
      { label: "Ask", href: "/ask", icon: MessageCircle, module: "ask" },
    ],
  },
  // review what the AI did and what waits for you
  {
    title: "Review",
    items: [
      { label: "Changes", href: "/changes", icon: ChangeIcon, admin: true, module: "changes" },
      { label: "Decisions", href: "/decisions", icon: DecisionIcon, admin: true, module: "decisions" },
      { label: "Exceptions", href: "/exceptions", icon: ExceptionIcon, admin: true, module: "exceptions" },
      ERROR_LOG_NAV,
    ],
  },
  // organize the wiki
  {
    title: "Organize",
    items: [
      { label: "Knowledge", href: "/units", icon: UnitIcon, admin: true, module: "knowledge" },
      { label: "Domains", href: "/domains", icon: DomainIcon, admin: true, module: "domains" },
      { label: "Entities", href: "/entities", icon: EntityIcon, admin: true, module: "entities" },
      { label: "Stakeholders", href: "/stakeholders", icon: Users, module: "stakeholders" },
    ],
  },
  // how the AI runs
  {
    title: "AI",
    items: [
      { label: "Workflow", href: "/workflow", icon: SkillIcon, admin: true, module: "workflow" },
      { label: "Agent Roles", href: "/roles", icon: Bot, admin: true, module: "agent_roles" },
    ],
  },
];

// The items a reader sees: modules that are off are hidden, and admin-only items unless in Admin mode
export function visibleNavItems(items: readonly NavItem[], { admin, modules }: { admin: boolean; modules: readonly ModuleFlagKey[] }): NavItem[] {
  return items.filter((item) => (admin || !item.admin) && (!item.module || modules.includes(item.module)));
}

// The sidebar's groups as a reader sees them, empty groups dropped
export function visibleNavGroups(options: { admin: boolean; modules: readonly ModuleFlagKey[] }): { title: string; items: NavItem[] }[] {
  return NAV_GROUPS.map((group) => ({ title: group.title, items: visibleNavItems(group.items, options) })).filter((group) => group.items.length > 0);
}

// True when `pathname` is this item's page or below it (Pages also matches wiki pages)
export function isActivePath(href: string, pathname: string): boolean {
  if (href === "/pages") return pathname === "/pages" || pathname.startsWith("/p/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

// SIDEBAR, FOOTER: settings, above the tutorial and sign-out buttons
export const SETTINGS_NAV: NavItem = { label: "Settings", href: "/settings", icon: SettingsIcon };
