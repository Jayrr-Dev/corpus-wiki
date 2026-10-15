"use client";

import { InfoIcon } from "@/components/icons";
import { Tooltip } from "@/components/standard/tooltip";

// SETTING HINT: small "i" beside a setting's label; hover explains the setting instead of a line of subtext
export function SettingHint({ children }: { children: string }) {
  return (
    <Tooltip content={children} side="right" className="max-w-64">
      <span aria-label={children} className="inline-flex text-muted-foreground hover:text-foreground">
        <InfoIcon size={14} />
      </span>
    </Tooltip>
  );
}
