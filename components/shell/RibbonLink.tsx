import Link from "next/link";
import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { NavItem } from "./nav";

// RIBBON BUTTON STYLE: shared by nav links and the sign-out button so they match
export const RIBBON_BUTTON_CLASS =
  "relative flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-text";

type RibbonLinkProps = { item: NavItem; isActive: boolean; badge?: ReactNode };

// RIBBON LINK: one icon button with a tooltip; the active page gets the hover gray
export function RibbonLink({ item, isActive, badge }: RibbonLinkProps) {
  const Icon = item.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={item.href}
          aria-label={item.label}
          aria-current={isActive ? "page" : undefined}
          className={cn(
            RIBBON_BUTTON_CLASS,
            isActive && "bg-hover text-text",
          )}
        >
          <Icon />
          {badge}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}
