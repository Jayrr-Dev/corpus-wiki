// Article prose does not use em dashes or en dashes. A pair around a phrase
// becomes parentheses. A single dash becomes a comma. Hyphens stay.
// A range dash (2019–2021, 9:00 – 17:00, Monday–Friday) becomes a hyphen first,
// so a range never turns into a list or a parenthesis. A range between dates written
// with month names (October 10, 1924 – December 10, 1978) keeps its spaced en dash, as
// encyclopedias write it.
// Each row is cleaned on its own, so the line breaks of a list, table or chart stay.

export function withoutEditorialDashes(text: string): string {
  return text.split("\n").map(cleanRow).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const MONTH = "(?:January|February|March|April|May|June|July|August|September|October|November|December)";
// The end of a date (a year, or a month and day) before a dash, and a date with a month after it
const DATE_RANGE = new RegExp(`(\\d{4}|${MONTH}\\s+\\d{1,2})\\s*[—–]\\s*(?=(?:\\d{1,2}\\s+)?${MONTH}\\b)`, "g");
const KEPT_DASH = "\u0000";

function cleanRow(row: string): string {
  const ranges = row
    .replace(DATE_RANGE, `$1 ${KEPT_DASH} `)
    .replace(/(\d%?)\s*[—–]\s*(?=[$€£]?\d)/g, "$1-")
    .replace(/([\p{L}\p{N}])–(?=[\p{L}\p{N}])/gu, "$1-");
  const paired = ranges.replace(/[—–]([^—–]+)[—–]/g, " ($1) ");
  return paired
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/[^\S\n]{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim()
    .replaceAll(KEPT_DASH, "–");
}
