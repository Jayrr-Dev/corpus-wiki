"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { formatCount } from "@/app/(app)/_lib/format";
import { Tooltip } from "@/components/standard/tooltip";
import { formatUsd } from "@/lib/ai/pricing";
import { cn } from "@/lib/utils";
import { dayInRange, heatLevel, heatmapWeeks, maxDayCost, monthLabels, nextDayRange, type DayRange, type HeatCell } from "./heatmapCells";
import type { UsageTotal } from "./summarizeUsage";

// One square per day. Darker green means more spend. Click picks the days whose prices show.

const LEVEL_CLASS = ["bg-muted", "bg-applied/30", "bg-applied/55", "bg-applied/80", "bg-applied"] as const;
const WEEKDAYS = ["Mon", "", "Wed", "", "Fri", "", ""] as const;

function cellLabel(cell: HeatCell): string {
  const [year, month, day] = cell.date.split("-").map(Number);
  const when = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  if (cell.calls <= 0) return `${when}. No calls.`;
  if (cell.costUsd <= 0) return `${when}. ${formatCount(cell.calls)} calls, no price.`;
  return `${when}. ${formatUsd(cell.costUsd)}. ${formatCount(cell.calls)} calls.`;
}

export function SpendHeatmap({ totals, range, today, onRangeChange }: {
  totals: readonly UsageTotal[];
  range: DayRange | null;
  today: string;
  onRangeChange: (range: DayRange | null) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const weeks = useMemo(() => heatmapWeeks(totals.map((total) => ({ day: total.day, costUsd: total.costUsd, calls: total.calls })), today), [totals, today]);
  const labels = useMemo(() => monthLabels(weeks), [weeks]);
  const busiest = useMemo(() => maxDayCost(weeks), [weeks]);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (node) node.scrollLeft = node.scrollWidth;
  }, [weeks.length]);

  return (
    <div className="mt-3">
      <div className="flex gap-2">
        <div aria-hidden="true" className="grid shrink-0 grid-rows-[14px_repeat(7,0.75rem)] gap-0.75 text-xs leading-none text-faint">
          <span />
          {WEEKDAYS.map((name, index) => <span key={name || `gap-${index}`} className="flex items-center">{name}</span>)}
        </div>
        <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto px-0.5 py-1">
          <div className="flex w-max gap-0.75" role="group" aria-label="Spend by day">
            {weeks.map((week, index) => (
              <div key={week.days.find((cell) => cell !== null)?.date ?? index} className="grid grid-rows-[14px_repeat(7,0.75rem)] gap-0.75">
                <span className="text-xs leading-none whitespace-nowrap text-faint">{labels[index] ?? ""}</span>
                {week.days.map((cell, dayIndex) => cell === null
                  ? <span key={`${index}-${dayIndex}`} />
                  : <DaySquare key={cell.date} cell={cell} level={heatLevel(cell.costUsd, cell.calls, busiest)} selected={dayInRange(cell.date, range)} today={cell.date === today} onPick={() => onRangeChange(nextDayRange(range, cell.date))} />)}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-1 flex items-center justify-end gap-1.5 text-xs text-faint">
        <span>Less</span>
        {LEVEL_CLASS.map((level) => <span key={level} aria-hidden="true" className={cn("size-3 rounded-xs", level)} />)}
        <span>More</span>
      </div>
    </div>
  );
}

function DaySquare({ cell, level, selected, today, onPick }: {
  cell: HeatCell;
  level: 0 | 1 | 2 | 3 | 4;
  selected: boolean;
  today: boolean;
  onPick: () => void;
}) {
  const label = cellLabel(cell);
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={selected}
        aria-current={today ? "date" : undefined}
        onClick={onPick}
        className={cn("size-3 rounded-xs", LEVEL_CLASS[level], selected ? "outline outline-1 outline-offset-1 outline-foreground" : today ? "outline outline-1 outline-foreground/70" : null)}
      />
    </Tooltip>
  );
}
