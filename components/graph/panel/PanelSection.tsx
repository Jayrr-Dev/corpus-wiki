"use client";

import { type ReactNode, useState } from "react";
import { InfoIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// INFO TIP: a small info icon; clicking it opens a popover with the hint, to its right
export function InfoTip({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} className={cn("shrink-0 rounded text-faint hover:text-text data-[state=open]:text-text", className)}>
          <InfoIcon className="size-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent variant="arrow" side="right" align="center" sideOffset={8} className="w-60">
        {children}
      </PopoverContent>
    </Popover>
  );
}

// PANEL SECTION: a collapsible block with a small chevron, like Obsidian's Filters / Groups / Display / Forces.
// `info` puts a hint behind an info icon on the right of the title.
export function PanelSection({ title, info, defaultOpen = false, children }: { title: string; info?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <section className="flex flex-col gap-2 border-b py-2 last:border-b-0">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
          className="flex flex-1 items-center gap-1.5 text-left text-panel font-medium text-muted-foreground hover:text-text"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={cn("transition-transform", isOpen && "rotate-90")}>
            <path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {title}
        </button>
        {info ? <InfoTip label={`About ${title}`}>{info}</InfoTip> : null}
      </div>
      {isOpen ? <div className="flex flex-col gap-3 pl-4">{children}</div> : null}
    </section>
  );
}
