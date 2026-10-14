import type { Enums, Json } from "@/lib/database/types";

// =====================================================================
// FORMATTING SHARED BY THE SCREENS: dates, enum words, JSON reads and
// one-line summaries of a typed action's input.
// =====================================================================

// DATES (UTC, so every screen and the database agree on the day)
export function formatDate(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "—";
}

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : "—";
}

// Local calendar day of a timestamp as YYYY-MM-DD (a file's own date for the date input)
export function toDateInputValue(epochMs: number): string {
  const date = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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

// EXCEPTION REASONS IN PLAIN WORDS
export const EXCEPTION_REASON_TEXT: Record<Enums<"exception_reason">, string> = {
  decision_conflict: "A new source contradicts a recorded decision",
  source_tie: "Two sources with the same date disagree",
  deletion: "The change would retire knowledge",
  low_confidence: "The AI was not confident enough to apply this",
  domain_tree_review: "The domain tree needs a one-time review",
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

// PASSAGE LOCATION: "p. 3 · Heading" from passages.location ({ page?, heading?, sectionPath? })
export function formatLocation(location: Json): string {
  const object = asObject(location);
  const page = object.page;
  const parts = [
    typeof page === "number" || typeof page === "string" ? `p. ${page}` : null,
    readString(object, "heading") ?? readStrings(object, "sectionPath").join(" / "),
  ];
  return parts.filter(Boolean).join(" · ") || "—";
}

// ACTION INPUT SUMMARY: the one line a person needs to recognise an action
export function describeActionInput(type: Enums<"action_type">, input: Json): string {
  const object = asObject(input);
  const text = (key: string) => readString(object, key) ?? "";
  switch (type) {
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
