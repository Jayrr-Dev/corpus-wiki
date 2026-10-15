import type { ComponentType } from "react";
import {
  ChangeIcon,
  DomainIcon,
  EntityIcon,
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

// SIDEBAR, MAIN GROUP: the five places named on the Frontend tab
export const PRIMARY_NAV: readonly NavItem[] = [
  { label: "Pages", href: "/", icon: PageIcon },
  { label: "Upload", href: "/upload", icon: UploadIcon },
  { label: "Knowledge", href: "/units", icon: UnitIcon },
  { label: "Changes", href: "/changes", icon: ChangeIcon },
  { label: "Exceptions", href: "/exceptions", icon: ExceptionIcon },
];

// SIDEBAR, BROWSE GROUP: the other table pages and the graph view
export const SECONDARY_NAV: readonly NavItem[] = [
  { label: "Sources", href: "/sources", icon: SourceIcon },
  { label: "Entities", href: "/entities", icon: EntityIcon },
  { label: "Domains", href: "/domains", icon: DomainIcon },
  { label: "Graph", href: "/graph", icon: GraphIcon },
  { label: "Skills", href: "/skills", icon: SkillIcon },
];

// True when `pathname` is this item's page or below it ("/" matches only itself and wiki pages)
export function isActivePath(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/p/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

// SIDEBAR, FOOTER: settings, above the tutorial and sign-out buttons
export const SETTINGS_NAV: NavItem = { label: "Settings", href: "/settings", icon: SettingsIcon };
