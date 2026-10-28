"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { createContext, useContext, type ReactNode } from "react";

// PREVIEW TABS: inside the graph preview, an article link opens a tab.
// On the wiki page the same words stay normal links.
const PreviewTabContext = createContext<
  ((href: string, label: string) => void) | null
>(null);

export function PreviewTabProvider({
  onOpen,
  children,
}: {
  onOpen: (href: string, label: string) => void;
  children: ReactNode;
}) {
  return (
    <PreviewTabContext.Provider value={onOpen}>
      {children}
    </PreviewTabContext.Provider>
  );
}

export function ArticleTextLink({
  href,
  label,
  className,
  children,
}: {
  href: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const open = useContext(PreviewTabContext);
  if (!open) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={cn("cursor-pointer border-0 bg-transparent p-0 text-left", className)}
      onClick={() => open(href, label)}
    >
      {children}
    </button>
  );
}
