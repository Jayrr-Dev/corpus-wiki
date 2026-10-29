import { isDocBlockContent, lineText } from "@/lib/docs/blocks";

// =====================================================================
// LINE BLOCKS: a line's text may lay its claims out as more than prose.
// The text stays plain and readable (search, diffs and history keep
// working), with a small Markdown-like syntax the page draws:
//
//   Basic items, worn at all times, include:      text: a paragraph
//   - Hard hats                                   bulleted list
//   1. Report the incident                        numbered list
//   > Employee-owned PPE is not allowed.          callout
//   | Class | Examples |                          table (first row is the header,
//   |---|---|                                      the |---| row is optional)
//   | A | Fighting, theft |
//   ```chart bar Incidents by quarter             chart: bar, hbar, line or pie,
//   Q1: 4                                          then a title; one "label: number"
//   Q2: 6                                          per row; ``` closes it
//   ```
//
// A line with no syntax is one paragraph, so every existing line still reads
// exactly as before. Pure: shared by the writer, the plan and the page.
// =====================================================================

export const CHART_KINDS = ["bar", "hbar", "line", "pie"] as const;
export type ChartKind = (typeof CHART_KINDS)[number];
export type ChartPoint = { label: string; value: number; display: string };

export type BlockPart =
  | { kind: "text"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "numbered"; items: string[] }
  | { kind: "callout"; text: string }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "chart"; chart: ChartKind; title: string; points: ChartPoint[] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const CALLOUT = /^\s*>\s?(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/;
const CHART_OPEN = /^\s*```\s*chart\s+(\w+)\s*(.*)$/i;
const FENCE_CLOSE = /^\s*```\s*$/;
// "label: 1,200", "label: 45%", "label: $3.5"; the label may itself contain a colon
const CHART_ROW = /^(.+):\s*([$€£]?)\s*(-?\d[\d,]*(?:\.\d+)?|-?\.\d+)\s*(%?)\s*$/;

// The parts of a line in order. Runs of the same kind group together; anything
// that does not parse as a block (a chart with too few rows, an unclosed fence)
// stays text, so the reader never loses words.
export function parseBlocks(content: string): BlockPart[] {
  const rows = content.replace(/\r\n?/g, "\n").split("\n");
  const parts: BlockPart[] = [];
  const push = (part: BlockPart) => {
    const last = parts[parts.length - 1];
    if (last?.kind === "text" && part.kind === "text") last.text = `${last.text} ${part.text}`;
    else if (last?.kind === "callout" && part.kind === "callout") last.text = `${last.text} ${part.text}`;
    else if ((last?.kind === "bullets" || last?.kind === "numbered") && part.kind === last.kind) last.items.push(...part.items);
    else parts.push(part);
  };
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    if (!row.trim()) continue;
    const chartOpen = CHART_OPEN.exec(row);
    if (chartOpen) {
      const close = rows.findIndex((candidate, at) => at > index && FENCE_CLOSE.test(candidate));
      const body = rows.slice(index + 1, close < 0 ? rows.length : close);
      const chart = parseChart(chartOpen[1]!, chartOpen[2]!, body);
      if (chart && close >= 0) {
        push(chart);
        index = close;
        continue;
      }
    }
    if (TABLE_ROW.test(row)) {
      let end = index;
      while (end + 1 < rows.length && TABLE_ROW.test(rows[end + 1]!)) end++;
      const table = parseTable(rows.slice(index, end + 1));
      if (table) {
        push(table);
        index = end;
        continue;
      }
    }
    const bullet = BULLET.exec(row);
    if (bullet) { push({ kind: "bullets", items: [bullet[1]!.trim()] }); continue; }
    const numbered = NUMBERED.exec(row);
    if (numbered) { push({ kind: "numbered", items: [numbered[1]!.trim()] }); continue; }
    const callout = CALLOUT.exec(row);
    if (callout && callout[1]!.trim()) { push({ kind: "callout", text: callout[1]!.trim() }); continue; }
    push({ kind: "text", text: row.trim() });
  }
  return parts;
}

// True when the line is more than one plain paragraph
export function isBlock(content: string): boolean {
  const parts = parseBlocks(content);
  return parts.length > 1 || (parts[0] !== undefined && parts[0].kind !== "text");
}

// The line as one run of words (for short previews such as the section panel)
export function blockSummary(content: string): string {
  if (isDocBlockContent(content)) return lineText(content).replace(/\s*\n\s*/g, " ");
  return parseBlocks(content).map((part) => {
    switch (part.kind) {
      case "text": case "callout": return part.text;
      case "bullets": case "numbered": return part.items.join("; ");
      case "table": return [part.header, ...part.rows].map((row) => row.join(", ")).join("; ");
      case "chart": return `${part.title}: ${part.points.map((point) => `${point.label} ${point.display}`).join(", ")}`;
    }
  }).join(" ");
}

// A pipe table: first row is the header; the |---| rule is skipped; short rows pad out
function parseTable(rows: string[]): BlockPart | null {
  const cells = rows.filter((row) => !TABLE_RULE.test(row)).map(splitRow);
  const [header, ...body] = cells;
  if (!header || !body.length || header.length < 2) return null;
  return { kind: "table", header, rows: body.map((row) => header.map((_, at) => row[at] ?? "")) };
}

function splitRow(row: string): string[] {
  return row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

// A chart needs a known kind and at least two rows that are "label: number"
function parseChart(kind: string, title: string, body: string[]): BlockPart | null {
  const chart = kind.toLowerCase();
  if (!(CHART_KINDS as readonly string[]).includes(chart)) return null;
  const points: ChartPoint[] = [];
  for (const row of body) {
    if (!row.trim()) continue;
    const match = CHART_ROW.exec(row.trim());
    if (!match) return null;
    const [, label, currency, number, percent] = match;
    points.push({ label: label!.trim(), value: Number(number!.replace(/,/g, "")), display: `${currency}${number}${percent}` });
  }
  if (points.length < 2) return null;
  return { kind: "chart", chart: chart as ChartKind, title: title.trim(), points };
}

// =====================================================================
// CHART CHECK: a chart's numbers are easy to invent and hard to spot, so
// every value must appear in a claim the line cites. A chart that fails
// is removed from the line; the rest of the line is kept.
// =====================================================================

export function numbersIn(text: string): Set<number> {
  return new Set([...text.matchAll(/-?\d[\d,]*(?:\.\d+)?|-?\.\d+/g)].map((match) => Number(match[0].replace(/,/g, ""))));
}

// =====================================================================
// PROSE NUMBER CHECK: the same rule for the rest of the line. Every number
// in its prose, lists and tables must appear in a claim the line cites
// (in digits or as a common number word) or in the page or section title.
// Charts are left to withSupportedCharts, and step numbers ("1. ") are not
// facts. A line that fails is dropped whole: the writer invented a number.
// =====================================================================

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000, dozen: 12,
  once: 1, twice: 2, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};

// "9:00" states the hour only, so it matches a claim that says "9 a.m."
const withoutWholeHours = (text: string) => text.replace(/(\d):00\b/g, "$1");

function proseNumbersIn(text: string): number[] {
  return [...withoutWholeHours(text).matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g)].map((match) => Number(match[0].replace(/,/g, "")));
}

// The line's rows outside any chart, without step numbers
function proseRows(content: string): string[] {
  const rows = content.split("\n");
  const kept: string[] = [];
  for (let index = 0; index < rows.length; index++) {
    const close = CHART_OPEN.test(rows[index]!) ? rows.findIndex((row, at) => at > index && FENCE_CLOSE.test(row)) : -1;
    if (close > index) { index = close; continue; }
    kept.push(rows[index]!.replace(/^\s*\d+[.)]\s+/, ""));
  }
  return kept;
}

// The numbers in the line's prose that no source text states (none: the line is supported)
export function unsupportedProseNumbers(content: string, sourceTexts: string[]): number[] {
  const source = withoutWholeHours(sourceTexts.join(" "));
  const known = new Set([...numbersIn(source)].map(Math.abs));
  for (const word of source.toLowerCase().match(/\p{L}+/gu) ?? []) if (word in NUMBER_WORDS) known.add(NUMBER_WORDS[word]!);
  return [...new Set(proseNumbersIn(proseRows(content).join("\n")).filter((number) => !known.has(number)))];
}

export function withSupportedCharts(content: string, claimTexts: string[]): string {
  if (!/```\s*chart/i.test(content)) return content;
  const known = numbersIn(claimTexts.join(" "));
  const rows = content.split("\n");
  const kept: string[] = [];
  for (let index = 0; index < rows.length; index++) {
    const open = CHART_OPEN.exec(rows[index]!);
    const close = open ? rows.findIndex((row, at) => at > index && FENCE_CLOSE.test(row)) : -1;
    if (open && close > index) {
      const chart = parseChart(open[1]!, open[2]!, rows.slice(index + 1, close));
      const supported = chart?.kind === "chart" && chart.points.every((point) => known.has(point.value));
      if (supported) kept.push(...rows.slice(index, close + 1));
      index = close;
      continue;
    }
    kept.push(rows[index]!);
  }
  return kept.join("\n").trim();
}
