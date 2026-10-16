import type { Enums, Json } from "@/lib/database/types";

// =====================================================================
// FORMATTING SHARED BY THE SCREENS: dates, enum words, JSON reads and
// one-line summaries of a typed action's input.
// =====================================================================

// DATES: "Feb 25, 26" and "Feb 25, 26 @ 9:30 pm". A day is a calendar
// day (UTC, as stored); a moment shows in the chosen time zone, or the
// device's zone via TimeZoneProvider. UTC is the server-render fallback.
export const DEFAULT_TIME_ZONE = "UTC";
export const TIME_ZONE_COOKIE = "time_zone";

function parseDate(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

// True when the runtime knows this IANA zone name ("Europe/London")
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function parts(date: Date, timeZone: string, withTime: boolean): Record<string, string> {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "2-digit",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit", hour12: true } : {}),
  });
  return Object.fromEntries(format.formatToParts(date).map((part) => [part.type, part.value]));
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = parseDate(iso);
  if (!date) return iso;
  const p = parts(date, "UTC", false);
  return `${p.month} ${p.day}, ${p.year}`;
}

export function formatDateTime(iso: string | null | undefined, timeZone = DEFAULT_TIME_ZONE): string {
  if (!iso) return "—";
  const date = parseDate(iso);
  if (!date) return iso;
  const p = parts(date, isTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE, true);
  return `${p.month} ${p.day}, ${p.year} @ ${p.hour}:${p.minute} ${(p.dayPeriod ?? "").toLowerCase()}`;
}

// Local calendar day of a timestamp as YYYY-MM-DD (a file's own date for the date input)
export function toDateInputValue(epochMs: number): string {
  const date = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// "18680" -> "18,680"; a missing count shows as a dash
export function formatCount(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("en-US");
}

// FILE SIZE in the largest unit that keeps it at or above 1 ("2.4 MB", "830 KB")
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 || value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

// TOKENS IN / OUT of an AI draft ("—" for a person's edit)
export function formatTokens(changeSet: { tokens_in: number | null; tokens_out: number | null }): string {
  if (changeSet.tokens_in === null && changeSet.tokens_out === null) return "—";
  return `${changeSet.tokens_in ?? 0} / ${changeSet.tokens_out ?? 0}`;
}

// ENUM WORDS: "partly_applied" -> "partly applied"
export function humanize(value: string): string {
  return value.replaceAll("_", " ");
}

// STATUS WORDS: "partly_applied" -> "Partly applied" (a label standing on its own)
export function statusLabel(value: string): string {
  const words = humanize(value);
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// WHO MADE A CHANGE: the person's name, or "AI · <model>". Rows from before people
// and models were recorded fall back to "Person" / "AI". Screens get the person's
// current name through useActorLabel (app/(app)/_lib/useActorLabel.ts).
export function actorLabel(kind: Enums<"actor_kind">, personName: string | null | undefined, model: string | null | undefined): string {
  if (kind === "person") return personName || "Person";
  return model ? `AI · ${modelName(model)}` : "AI";
}

// "meta-llama/Llama-3.3-70B-Instruct" → "Llama-3.3-70B-Instruct"
export function modelName(model: string): string {
  return model.slice(model.lastIndexOf("/") + 1) || model;
}

// EXCEPTION REASONS IN PLAIN WORDS
export const EXCEPTION_REASON_TEXT: Record<Enums<"exception_reason">, string> = {
  decision_conflict: "A new source contradicts a recorded decision",
  source_tie: "Two sources with the same date disagree",
  deletion: "The change would retire knowledge",
  low_confidence: "The AI was not confident enough to apply this",
  domain_tree_review: "The domain tree needs a one-time review",
  root_domain_approval: "The AI wants to create a new root domain",
  update_request: "The AI wants to change a line a person wrote",
};

// JSON READS (jsonb columns arrive as Json; these narrow without casts to any)
export type JsonObject = { [key: string]: Json | undefined };

export function asObject(value: Json | undefined): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function readString(object: JsonObject, key: string): string | null {
  const value = object[key];
  return typeof value === "string" ? value : null;
}

export function readStrings(object: JsonObject, key: string): string[] {
  const value = object[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

// CHECK RESULTS: actions.check_results as [{ name, passed, detail }]
export type CheckResult = { name: string; passed: boolean; detail: string | null };

export function readCheckResults(value: Json): CheckResult[] {
  if (!Array.isArray(value)) return [];
  return value.map(asObject).map((check) => ({
    name: readString(check, "name") ?? "check",
    passed: check.passed === true,
    detail: readString(check, "detail"),
  }));
}

// PASSAGE LOCATION: "p. 3 · Heading" or "at 01:23" from passages.location ({ page?, heading?, sectionPath?, time? })
export function formatLocation(location: Json): string {
  const object = asObject(location);
  const page = object.page;
  const parts = [
    typeof page === "number" || typeof page === "string" ? `p. ${page}` : null,
    readString(object, "heading") ?? readStrings(object, "sectionPath").join(" / "),
    readString(object, "time") ? `at ${readString(object, "time")}` : null,
  ];
  return parts.filter(Boolean).join(" · ") || "—";
}

// READABLE PASSAGE: extracted PDF text keeps the page's hard line wraps and table-of-contents dot
// leaders. Single line breaks become spaces (list items and paragraphs keep theirs), each bullet
// starts a line, and a leader run becomes "… <page>" ending its entry. Display only: the stored
// text is what claims quote.
export function readablePassage(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/([^\n])\n(?!\n|[ \t]*(?:[-*•▪◦]|\d+[.)])[ \t])/g, "$1 ")
    .replace(/[ \t]+([•▪◦])[ \t]/g, "\n$1 ")
    .replace(/[ \t]*(?:[.…·][ \t]?){4,}[ \t]*(\d+)?[ \t]*/g, (_, page?: string) => (page ? ` … ${page}\n` : " …\n"))
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

// ACTION INPUT SUMMARY: the one line a person needs to recognise an action
export function describeActionInput(type: Enums<"action_type">, input: Json): string {
  const review = asObject(input);
  if (review.domainReview === true) {
    if (review.operation === "inspect") return "Acknowledge the question; the domain structure stays unchanged.";
    if (review.operation === "none") return "Keep the current domain structure.";
    if (review.operation === "rename") return `Rename the domain to “${review.name}”.`;
    if (review.operation === "merge") return "Consolidate the equivalent domains under their shared parent.";
  }
  const object = asObject(input);
  const text = (key: string) => readString(object, key) ?? "";
  switch (type) {
    case "glossary_update":
      return `${text("operation")} glossary: ${object.total ?? 0} definitions`;
    case "review_page":
      return text("recommendation");
    case "source_lifecycle":
      return `${text("operation")} source “${text("title")}”: ${text("reason")}`;
    case "source_review":
      return `${text("stage")} ${text("outcome")}: ${text("reason")}`;
    case "create_domain":
      return text("path");
    case "create_entity":
      return `${text("name")} (${text("type")})`;
    case "add_claim":
    case "revise_claim":
      return text("content");
    case "retire_claim":
      return text("reason");
    case "merge_duplicates":
      return `${readStrings(object, "duplicateUnitIds").length} duplicate(s) merged into the target`;
    case "link":
      return `${humanize(text("type"))} → ${text("toUnitId").slice(0, 8)}`;
    case "set_epistemic_status":
      return `status → ${text("epistemicStatus")}`;
    case "write_line":
    case "revise_line":
      return text("content");
    case "retire_line":
      return "line removed";
    case "move_line":
      return `line moved to ${String(object.position ?? "")}`;
    case "create_page":
      return `page “${text("title")}”`;
    case "create_section":
      return `section “${text("title")}”`;
    case "rename_page":
    case "rename_section":
      return `renamed to “${text("title")}”`;
    case "retire_page":
      return "page removed";
    case "retire_section":
      return "section removed";
    case "update_entity":
      return `renamed to “${text("name")}”`;
    case "update_domain":
      return `renamed to “${text("name")}”`;
    case "retire_entity":
    case "retire_domain":
      return text("reason");
  }
}
