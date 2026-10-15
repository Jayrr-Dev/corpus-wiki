"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Tooltip } from "@/components/standard/tooltip";
import { type ArticleLink, linkArticleText } from "@/lib/living-page/articleEvidence";
import { type BlockPart, type ChartPoint, parseBlocks } from "@/lib/living-page/blocks";
import { cn } from "@/lib/utils";

// =====================================================================
// LINE BLOCK: one line drawn from its parts (see lib/living-page/blocks.ts):
// prose, lists, a callout, a table or a single-series chart. Charts are
// plain HTML/SVG in the page's own ink, one series each (so no legend),
// with every value on hover and in a screen-reader table.
// =====================================================================

export function LineBlock({ content, links = [], trailing }: { content: string; links?: ArticleLink[]; trailing?: ReactNode }) {
  const parts = parseBlocks(content);
  const last = parts.length - 1;
  return (
    <div className="space-y-3">
      {parts.map((part, index) => (
        <BlockPartView key={index} part={part} links={links} trailing={index === last ? trailing : null} />
      ))}
      {parts[last]?.kind === "table" || parts[last]?.kind === "chart" ? <p className="-mt-2 text-body leading-7">{trailing}</p> : null}
    </div>
  );
}

// Article links inside any piece of text, as on a prose paragraph
function Linked({ text, links }: { text: string; links: ArticleLink[] }) {
  return linkArticleText(text, links).map((chunk, index) => chunk.href ? (
    <Link key={index} href={chunk.href} className="text-link hover:underline">{chunk.text}</Link>
  ) : <span key={index}>{chunk.text}</span>);
}

// `trailing` (citations and the details button) ends a closing paragraph, callout or list; it goes under a table or chart
function BlockPartView({ part, links, trailing }: { part: BlockPart; links: ArticleLink[]; trailing: ReactNode }) {
  switch (part.kind) {
    case "text":
      return <p className="text-body leading-7"><Linked text={part.text} links={links} />{trailing}</p>;
    case "callout":
      return <p className="rounded-md border-l-2 border-link bg-hover/60 px-4 py-2 text-body leading-7"><Linked text={part.text} links={links} />{trailing}</p>;
    case "bullets":
    case "numbered": {
      const List = part.kind === "bullets" ? "ul" : "ol";
      return (
        <List className={cn("space-y-1 pl-6 text-body leading-7", part.kind === "bullets" ? "list-disc" : "list-decimal")}>
          {part.items.map((item, index) => <li key={index} className="pl-1"><Linked text={item} links={links} />{index === part.items.length - 1 ? trailing : null}</li>)}
        </List>
      );
    }
    case "table":
      return (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-panel">
            <thead>
              <tr className="border-b">{part.header.map((cell, index) => <th key={index} scope="col" className="px-3 py-2 font-semibold">{cell}</th>)}</tr>
            </thead>
            <tbody>
              {part.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b last:border-b-0">
                  {row.map((cell, index) => <td key={index} className="px-3 py-1.5 align-top text-muted-foreground"><Linked text={cell} links={links} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "chart":
      return (
        <figure className="rounded-lg border p-4">
          <figcaption className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{part.title || "Chart"}</figcaption>
          {part.chart === "bar" ? <ColumnChart points={part.points} /> : null}
          {part.chart === "hbar" ? <BarRows points={part.points} /> : null}
          {part.chart === "line" ? <LineChart points={part.points} /> : null}
          {part.chart === "pie" ? <PieChart points={part.points} /> : null}
          <table className="sr-only">
            <caption>{part.title}</caption>
            <tbody>{part.points.map((point, index) => <tr key={index}><th scope="row">{point.label}</th><td>{point.display}</td></tr>)}</tbody>
          </table>
        </figure>
      );
  }
}

// =====================================================================
// CHARTS: values from zero (bars) or across their range (line); the
// hover target is the whole column/row/slice, not just the mark.
// =====================================================================

const pointHint = (point: ChartPoint) => `${point.label}: ${point.display}`;
const largest = (points: ChartPoint[]) => Math.max(...points.map((point) => point.value), 0) || 1;

// Vertical bars with the category under each; the top gridline names the scale
function ColumnChart({ points }: { points: ChartPoint[] }) {
  const max = largest(points);
  const top = points.find((point) => point.value === max);
  return (
    <div aria-hidden="true">
      <div className="relative flex h-40 items-end gap-2 border-b">
        <span className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed" />
        <span className="pointer-events-none absolute -top-2 right-0 bg-background pl-1 text-xs text-faint">{top?.display}</span>
        {points.map((point, index) => (
          <Tooltip key={index} content={pointHint(point)}>
            <div className="group flex h-full flex-1 items-end justify-center">
              <div className="w-full max-w-12 h-(--size) rounded-t-md bg-foreground/60 transition-colors group-hover:bg-foreground" style={{ "--size": `${Math.max(0, point.value / max) * 100}%` } as CSSProperties} />
            </div>
          </Tooltip>
        ))}
      </div>
      <div className="mt-1.5 flex gap-2">
        {points.map((point, index) => <span key={index} className="flex-1 truncate text-center text-xs text-muted-foreground">{point.label}</span>)}
      </div>
    </div>
  );
}

// Horizontal bars for long category names, value at the end of each bar
function BarRows({ points }: { points: ChartPoint[] }) {
  const max = largest(points);
  return (
    <div aria-hidden="true" className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
      {points.map((point, index) => (
        <Tooltip key={index} content={pointHint(point)}>
          <div className="group col-span-2 grid grid-cols-subgrid items-center">
            <span className="truncate text-right text-xs text-muted-foreground">{point.label}</span>
            <span className="flex items-center gap-2">
              <span className="h-5 w-(--size) rounded-r-md bg-foreground/60 transition-colors group-hover:bg-foreground" style={{ "--size": `${Math.max(0, point.value / max) * 85}%` } as CSSProperties} />
              <span className="text-xs text-faint">{point.display}</span>
            </span>
          </div>
        </Tooltip>
      ))}
    </div>
  );
}

// A 2px line across the plot, a marker per value; the plot stretches, the stroke does not
function LineChart({ points }: { points: ChartPoint[] }) {
  const values = points.map((point) => point.value);
  const min = Math.min(...values, 0);
  const span = Math.max(...values) - min || 1;
  const at = (index: number) => ({ x: points.length > 1 ? (index / (points.length - 1)) * 100 : 50, y: 100 - ((points[index]!.value - min) / span) * 100 });
  const path = points.map((_, index) => `${index ? "L" : "M"}${at(index).x},${at(index).y}`).join(" ");
  return (
    <div aria-hidden="true" className="px-1.5">
      <div className="relative h-40 border-b">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
          <path d={path} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" className="text-foreground/70" />
        </svg>
        {points.map((point, index) => (
          <Tooltip key={index} content={pointHint(point)}>
            <span className="group absolute top-(--y) left-(--x) flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center" style={{ "--x": `${at(index).x}%`, "--y": `${at(index).y}%` } as CSSProperties}>
              <span className="size-2 rounded-full bg-foreground ring-2 ring-background transition-transform group-hover:scale-150" />
            </span>
          </Tooltip>
        ))}
      </div>
      <div className="relative mt-1.5 h-4">
        {points.map((point, index) => (
          <span key={index} className={cn("absolute max-w-24 truncate text-xs text-muted-foreground", index === 0 ? "left-0" : index === points.length - 1 ? "right-0" : "left-(--x) -translate-x-1/2")} style={{ "--x": `${at(index).x}%` } as CSSProperties}>{point.label}</span>
        ))}
      </div>
    </div>
  );
}

// Parts of one whole: at most six slices (the rest fold into Other), told apart by
// ink depth and named in the list beside it with their share, so color is never alone
const PIE_SLICES = 6;
const PIE_INK = [0.9, 0.65, 0.45, 0.32, 0.22, 0.14];

function PieChart({ points }: { points: ChartPoint[] }) {
  const positive = points.filter((point) => point.value > 0).sort((a, b) => b.value - a.value);
  const shown = positive.length > PIE_SLICES ? positive.slice(0, PIE_SLICES - 1) : positive;
  const rest = positive.slice(shown.length);
  const slices = rest.length ? [...shown, { label: "Other", value: rest.reduce((sum, point) => sum + point.value, 0), display: "" }] : shown;
  const total = slices.reduce((sum, point) => sum + point.value, 0) || 1;
  const arcs = slices.map((point, index) => {
    const before = slices.slice(0, index).reduce((sum, other) => sum + other.value, 0);
    const start = -Math.PI / 2 + (before / total) * Math.PI * 2;
    return { point, start, end: start + (point.value / total) * Math.PI * 2 };
  });
  const share = (value: number) => `${Math.round((value / total) * 100)}%`;
  return (
    <div aria-hidden="true" className="flex flex-wrap items-center gap-6">
      <svg viewBox="-1 -1 2 2" className="size-36 shrink-0 text-foreground">
        {arcs.map(({ point, start, end }, index) => (
          <Tooltip key={index} content={`${point.label}: ${point.display || point.value} (${share(point.value)})`}>
            <path d={slicePath(start, end)} fill="currentColor" fillOpacity={PIE_INK[index]} stroke="var(--color-background)" strokeWidth={0.03} className="transition-opacity hover:opacity-80" />
          </Tooltip>
        ))}
      </svg>
      <ul className="min-w-0 space-y-1 text-xs">
        {arcs.map(({ point }, index) => (
          <li key={index} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-sm bg-foreground opacity-(--ink)" style={{ "--ink": String(PIE_INK[index]) } as CSSProperties} />
            <span className="truncate">{point.label}</span>
            <span className="text-faint">{point.display ? `${point.display} · ` : ""}{share(point.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function slicePath(start: number, end: number): string {
  if (end - start >= Math.PI * 2 - 1e-6) return "M0,-1 A1,1 0 1 1 0,1 A1,1 0 1 1 0,-1 Z";
  const point = (angle: number) => `${Math.cos(angle)},${Math.sin(angle)}`;
  return `M0,0 L${point(start)} A1,1 0 ${end - start > Math.PI ? 1 : 0} 1 ${point(end)} Z`;
}
