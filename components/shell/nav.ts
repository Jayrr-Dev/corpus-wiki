import type { ComponentType } from "react";
import { BookOpen, MessageCircle, Users } from "lucide-react";
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

export type NavItem = { label: string; href: string; icon: ComponentType<IconProps> };

// SIDEBAR, MAIN GROUP: the places named on the Frontend tab, plus the graph view
export const PRIMARY_NAV: readonly NavItem[] = [
  { label: "Pages", href: "/", icon: PageIcon },
  { label: "Glossary", href: "/glossary", icon: BookOpen },
  { label: "Stakeholders", href: "/stakeholders", icon: Users },
  { label: "Graph", href: "/graph", icon: GraphIcon },
  { label: "Ask", href: "/ask", icon: MessageCircle },
  { label: "Upload", href: "/upload", icon: UploadIcon },
  { label: "Knowledge", href: "/units", icon: UnitIcon },
  { label: "Changes", href: "/changes", icon: ChangeIcon },
  { label: "Decisions", href: "/decisions", icon: DecisionIcon },
  { label: "Exceptions", href: "/exceptions", icon: ExceptionIcon },
];

// SIDEBAR, BROWSE GROUP: the other table pages
export const SECONDARY_NAV: readonly NavItem[] = [
  { label: "Sources", href: "/sources", icon: SourceIcon },
  { label: "Entities", href: "/entities", icon: EntityIcon },
  { label: "Domains", href: "/domains", icon: DomainIcon },
  { label: "Workflow", href: "/skills", icon: SkillIcon },
];

// True when `pathname` is this item's page or below it ("/" matches only itself and wiki pages)
export function isActivePath(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/p/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

// SIDEBAR, FOOTER: the error log and settings, above the tutorial and sign-out buttons
export const ERROR_LOG_NAV: NavItem = { label: "Error log", href: "/errors", icon: ErrorLogIcon };
export const SETTINGS_NAV: NavItem = { label: "Settings", href: "/settings", icon: SettingsIcon };
