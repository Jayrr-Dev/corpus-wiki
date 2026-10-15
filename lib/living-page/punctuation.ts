// Article prose does not use em dashes or en dashes. A pair around a phrase
// becomes parentheses. A single dash becomes a comma. Hyphens stay.
// Each row is cleaned on its own, so the line breaks of a list, table or chart stay.

export function withoutEditorialDashes(text: string): string {
  return text.split("\n").map(cleanRow).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function cleanRow(row: string): string {
  const paired = row.replace(/[—–]([^—–]+)[—–]/g, " ($1) ");
  return paired
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/[^\S\n]{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}
