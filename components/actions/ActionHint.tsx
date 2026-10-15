"use client";

import { InfoIcon } from "@/components/icons";
import { Tooltip } from "@/components/standard/tooltip";

// ACTION HINT: borderless "i" at the far right of an action button or menu item; hover explains the action.
// Clicks on it are swallowed so reading the hint never starts the action.
export function ActionHint({ children }: { children: string }) {
  return (
    <Tooltip content={children} side="right" className="max-w-64">
      <span
        aria-label={children}
        className="ml-auto inline-flex text-muted-foreground hover:text-foreground"
        onClick={(event) => event.stopPropagation()}
      >
        <InfoIcon size={14} />
      </span>
    </Tooltip>
  );
}
