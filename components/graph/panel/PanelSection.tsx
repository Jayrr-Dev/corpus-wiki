"use client";

import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";

// PANEL SECTION: a collapsible block with a small chevron, like Obsidian's Filters / Groups / Display / Forces
export function PanelSection({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <section className="flex flex-col gap-2 border-b py-2 last:border-b-0">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="flex items-center gap-1.5 text-left text-panel font-medium text-muted-foreground hover:text-text"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={cn("transition-transform", isOpen && "rotate-90")}>
          <path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {title}
      </button>
      {isOpen ? <div className="flex flex-col gap-3 pl-4">{children}</div> : null}
    </section>
  );
}
