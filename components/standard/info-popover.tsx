"use client";

import type { ReactNode } from "react";
import { InfoIcon } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// INFO POPOVER: small "i" beside a heading; a click opens the explanation that would otherwise sit under it as subtext
export function InfoPopover({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} className="inline-flex shrink-0 text-muted-foreground hover:text-foreground">
          <InfoIcon size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 leading-relaxed text-muted-foreground">
        {children}
      </PopoverContent>
    </Popover>
  );
}
