import { describe, expect, it } from "vitest";
import { formatDaySpan, heatLevel, heatmapWeeks, monthLabels, nextDayRange } from "./heatmapCells";

const day = (date: string, costUsd: number, calls = 1) => ({ day: date, costUsd, calls });

describe("spend heatmap", () => {
  it("lays weeks out from Monday, leaving days outside the span blank", () => {
    const weeks = heatmapWeeks([day("2026-10-14", 2), day("2026-10-15", 0, 1)], "2026-10-16");
    expect(weeks).toHaveLength(1);
    expect(weeks[0]?.days.map((cell) => cell?.date ?? null)).toEqual([
      null, null, "2026-10-14", "2026-10-15", "2026-10-16", null, null,
    ]);
    expect(weeks[0]?.days[2]).toMatchObject({ costUsd: 2, calls: 1 });
    expect(weeks[0]?.days[4]).toMatchObject({ costUsd: 0, calls: 0 });
  });

  it("labels the month that starts in a week, and skips a colliding opening label", () => {
    const weeks = heatmapWeeks([day("2026-10-20", 1)], "2026-11-02");
    const labels = monthLabels(weeks);
    expect(labels[0]).toBeNull();
    expect(labels[1]).toBe("Nov");
  });

  it("steps the color by share of the busiest day", () => {
    expect(heatLevel(0, 0, 4)).toBe(0);
    expect(heatLevel(0, 2, 4)).toBe(1);
    expect(heatLevel(1, 1, 4)).toBe(1);
    expect(heatLevel(2, 1, 4)).toBe(2);
    expect(heatLevel(3, 1, 4)).toBe(3);
    expect(heatLevel(4, 1, 4)).toBe(4);
  });

  it("picks a day, stretches to a second day, then clears or starts over", () => {
    expect(nextDayRange(null, "2026-10-14")).toEqual({ start: "2026-10-14", end: "2026-10-14" });
    expect(nextDayRange({ start: "2026-10-18", end: "2026-10-18" }, "2026-10-14")).toEqual({ start: "2026-10-14", end: "2026-10-18" });
    expect(nextDayRange({ start: "2026-10-14", end: "2026-10-14" }, "2026-10-14")).toBeNull();
    expect(nextDayRange({ start: "2026-10-14", end: "2026-10-18" }, "2026-10-16")).toEqual({ start: "2026-10-16", end: "2026-10-16" });
  });

  it("names one day or the stretch between two", () => {
    expect(formatDaySpan({ start: "2026-10-14", end: "2026-10-14" }, "2026-10-28")).toBe("October 14");
    expect(formatDaySpan({ start: "2026-10-18", end: "2026-10-14" }, "2026-10-28")).toBe("October 14 to October 18");
    expect(formatDaySpan({ start: "2025-12-30", end: "2026-01-02" }, "2026-10-28")).toBe("December 30, 2025 to January 2, 2026");
  });
});
