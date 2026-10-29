"use client";

import type { CSSProperties } from "react";
import { Tooltip } from "@/components/standard/tooltip";
import { LEVEL_LABELS, LEVELS, type LevelKey } from "@/lib/study/levels";
import { cn } from "@/lib/utils";

// One shade per level, faint for New up to full for Learned
export const LEVEL_TONE: Record<LevelKey, string> = { new: "bg-muted", familiar: "bg-link/35", known: "bg-link/65", learned: "bg-link" };

// LEVELS BAR: how many claims sit at each level, as one small stacked bar
export function LevelBar({ levels, className }: { levels: Record<LevelKey, number>; className?: string }) {
  const total = LEVELS.reduce((sum, level) => sum + levels[level], 0);
  const summary = LEVELS.map((level) => `${LEVEL_LABELS[level]} ${levels[level]}`).join(" · ");
  return (
    <Tooltip content={summary}>
      <div role="img" aria-label={summary} className={cn("flex h-1.5 w-24 overflow-hidden rounded-full bg-muted", className)}>
        {total ? LEVELS.map((level) => levels[level] ? <span key={level} className={cn("w-(--share)", LEVEL_TONE[level])} style={{ "--share": `${(levels[level] / total) * 100}%` } as CSSProperties} /> : null) : null}
      </div>
    </Tooltip>
  );
}

// COVERAGE BAR: the share of a set's claims practiced at least once
export function CoverageBar({ percent }: { percent: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full w-(--share) bg-link" style={{ "--share": `${percent}%` } as CSSProperties} />
      </div>
      <span className="text-panel text-muted-foreground">{percent}% practiced</span>
    </div>
  );
}
