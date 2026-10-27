import type { ComponentType } from "react";
import { BookOpen, Bot, Globe2, Images, MessageCircle, Users } from "lucide-react";
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

// `admin`: shown only in Admin mode (the sidebar's Admin / User switch)
export type NavItem = { label: string; href: string; icon: ComponentType<IconProps>; admin?: boolean };

// SIDEBAR GROUPS: one kind of job each, split by a hairline
export const NAV_GROUPS: readonly (readonly NavItem[])[] = [
  // read and ask
  [
    { label: "Pages", href: "/", icon: PageIcon },
    { label: "Graph", href: "/graph", icon: GraphIcon },
    { label: "Glossary", href: "/glossary", icon: BookOpen },
    { label: "Stakeholders", href: "/stakeholders", icon: Users },
    { label: "Ask", href: "/ask", icon: MessageCircle },
  ],
  // bring material in
  [
    { label: "Upload", href: "/upload", icon: UploadIcon },
    { label: "Sources", href: "/sources", icon: SourceIcon, admin: true },
    { label: "Assets", href: "/assets", icon: Images, admin: true },
  ],
  // review what the AI did and what waits for you
  [
    { label: "Knowledge", href: "/units", icon: UnitIcon, admin: true },
    { label: "Changes", href: "/changes", icon: ChangeIcon, admin: true },
    { label: "Decisions", href: "/decisions", icon: DecisionIcon, admin: true },
    { label: "Exceptions", href: "/exceptions", icon: ExceptionIcon, admin: true },
  ],
  // organize and publish
  [
    { label: "Domains", href: "/domains", icon: DomainIcon, admin: true },
    { label: "Entities", href: "/entities", icon: EntityIcon, admin: true },
    { label: "Publishing", href: "/publishing", icon: Globe2, admin: true },
  ],
  // how the AI runs
  [
    { label: "Workflow", href: "/workflow", icon: SkillIcon, admin: true },
    { label: "Agent Roles", href: "/roles", icon: Bot, admin: true },
  ],
];

// True when `pathname` is this item's page or below it ("/" matches only itself and wiki pages)
export function isActivePath(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/p/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

// SIDEBAR, FOOTER: the error log and settings, above the tutorial and sign-out buttons
export const ERROR_LOG_NAV: NavItem = { label: "Error log", href: "/errors", icon: ErrorLogIcon, admin: true };
export const SETTINGS_NAV: NavItem = { label: "Settings", href: "/settings", icon: SettingsIcon };
