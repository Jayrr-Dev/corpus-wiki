"use client";

import { InfoIcon } from "@/components/icons";
import { Tooltip } from "@/components/standard/tooltip";

// INFO HINT: small "i" beside a label or heading; hover (or keyboard focus) shows one or
// two plain sentences that would otherwise sit under it as subtext. For longer text,
// links, code or lists, use InfoPopover (components/standard/info-popover.tsx).
export function InfoHint({ children }: { children: string }) {
  return (
    <Tooltip content={children} side="right" className="max-w-64">
      <span tabIndex={0} aria-label={children} className="inline-flex shrink-0 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <InfoIcon size={14} />
      </span>
    </Tooltip>
  );
}
