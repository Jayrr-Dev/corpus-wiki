// =====================================================================
// SPEND HEATMAP: one square per UTC day, weeks as columns, Monday first.
// Pure, so the calendar and the click-to-filter rules are unit-tested.
// =====================================================================

export type DayRange = { start: string; end: string };

export type HeatCell = { date: string; costUsd: number; calls: number };

export type HeatWeek = { days: Array<HeatCell | null> };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

type DaySpend = { day: string; costUsd: number; calls: number };

// Shifts a YYYY-MM-DD by whole UTC days
export function addUtcDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// The Monday of the week that contains this UTC day
export function mondayOnOrBefore(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  const mondayIndex = (date.getUTCDay() + 6) % 7;
  return addUtcDays(iso, -mondayIndex);
}

export function monthShort(iso: string): string {
  return MONTHS[Number(iso.slice(5, 7)) - 1] ?? "";
}

// Weeks from the first spend day through today (or the last call, if later)
export function heatmapWeeks(totals: readonly DaySpend[], today: string): HeatWeek[] {
  if (totals.length === 0) return [];
  const sorted = [...totals].sort((a, b) => a.day.localeCompare(b.day));
  const byDay = new Map(sorted.map((total) => [total.day, total]));
  const first = sorted[0]!.day;
  const last = sorted[sorted.length - 1]!.day;
  const end = last > today ? last : today;
  const weeks: HeatWeek[] = [];
  for (let monday = mondayOnOrBefore(first); monday <= end; monday = addUtcDays(monday, 7)) {
    const days: Array<HeatCell | null> = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const date = addUtcDays(monday, offset);
      if (date < first || date > end) days.push(null);
      else {
        const total = byDay.get(date);
        days.push({ date, costUsd: total?.costUsd ?? 0, calls: total?.calls ?? 0 });
      }
    }
    weeks.push({ days });
  }
  return weeks;
}

// A month name above the week that contains the 1st. The opening week is
// labeled too, unless the next month starts within two weeks (the names would collide).
export function monthLabels(weeks: readonly HeatWeek[]): Array<string | null> {
  const labels = weeks.map((week, index) => {
    const firstOfMonth = week.days.find((day) => day?.date.endsWith("-01"));
    if (firstOfMonth) return monthShort(firstOfMonth.date);
    if (index === 0) {
      const first = week.days.find((day) => day !== null);
      return first ? monthShort(first.date) : null;
    }
    return null;
  });
  return labels.map((label, index) => {
    if (label === null) return null;
    const nextSoon = labels.slice(index + 1, index + 3).some((item) => item !== null);
    const isMonthStart = weeks[index]?.days.some((day) => day?.date.endsWith("-01")) ?? false;
    if (nextSoon && !isMonthStart) return null;
    return label;
  });
}

// 0 is an empty day. 1 through 4 step up to the busiest day's spend.
export function heatLevel(costUsd: number, calls: number, maxCost: number): 0 | 1 | 2 | 3 | 4 {
  if (calls <= 0) return 0;
  if (costUsd <= 0 || maxCost <= 0) return 1;
  const share = costUsd / maxCost;
  if (share <= 0.25) return 1;
  if (share <= 0.5) return 2;
  if (share <= 0.75) return 3;
  return 4;
}

export function maxDayCost(weeks: readonly HeatWeek[]): number {
  let max = 0;
  for (const week of weeks) {
    for (const day of week.days) {
      if (day !== null && day.costUsd > max) max = day.costUsd;
    }
  }
  return max;
}

export function dayInRange(day: string, range: DayRange | null): boolean {
  if (range === null) return false;
  const start = range.start <= range.end ? range.start : range.end;
  const end = range.start <= range.end ? range.end : range.start;
  return day >= start && day <= end;
}

// First click picks a day. A second click includes the days between.
// Clicking the only chosen day clears the filter. A later click starts over.
export function nextDayRange(current: DayRange | null, day: string): DayRange | null {
  if (current === null) return { start: day, end: day };
  const start = current.start <= current.end ? current.start : current.end;
  const end = current.start <= current.end ? current.end : current.start;
  if (start === end && start === day) return null;
  if (start === end) return day < start ? { start: day, end: start } : { start, end: day };
  return { start: day, end: day };
}

function formatDay(iso: string, withYear: boolean): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

// "October 14", or "October 14 to November 2" when two days are picked
export function formatDaySpan(range: DayRange, today: string): string {
  const start = range.start <= range.end ? range.start : range.end;
  const end = range.start <= range.end ? range.end : range.start;
  const thisYear = today.slice(0, 4);
  if (start === end) return formatDay(start, start.slice(0, 4) !== thisYear);
  if (start.slice(0, 4) === end.slice(0, 4)) return `${formatDay(start, false)} to ${formatDay(end, start.slice(0, 4) !== thisYear)}`;
  return `${formatDay(start, true)} to ${formatDay(end, true)}`;
}
