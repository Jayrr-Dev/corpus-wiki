"use client";

import { usePathname } from "next/navigation";
import { useExceptions } from "@/lib/queries";
import { signOut } from "@/lib/auth/actions";
import { isActivePath, type NavItem, PRIMARY_NAV, SECONDARY_NAV } from "./nav";
import { RibbonLink } from "./RibbonLink";

// OPEN EXCEPTION COUNT: the one "needs you" number on every screen
function useOpenExceptionCount(): number {
  const { data } = useExceptions({ filters: { status: "open" } });
  return data?.length ?? 0;
}

// NEEDS-YOU BADGE: a small orange count, hidden at zero
function NeedsYouBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="absolute -top-0.5 -right-0.5 min-w-3.5 rounded-full bg-needs-you px-1 text-center font-mono text-xs leading-3.5 text-background">
      {count}
    </span>
  );
}

// RIBBON: narrow icon column that switches between the app's places
export function Ribbon() {
  const pathname = usePathname();
  const openCount = useOpenExceptionCount();
  const renderLink = (item: NavItem) => (
    <RibbonLink
      key={item.href}
      item={item}
      isActive={isActivePath(item.href, pathname)}
      badge={item.href === "/exceptions" ? <NeedsYouBadge count={openCount} /> : undefined}
    />
  );
  return (
    <nav aria-label="Main" className="flex w-11 shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-2">
      {PRIMARY_NAV.map(renderLink)}
      <div className="my-1 h-px w-5 bg-border" />
      {SECONDARY_NAV.map(renderLink)}
      <form action={signOut} className="mt-auto">
        <button type="submit" className="rounded-md px-1 py-1 text-xs text-faint hover:bg-hover hover:text-text">
          Sign out
        </button>
      </form>
    </nav>
  );
}
