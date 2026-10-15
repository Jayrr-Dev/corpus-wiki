// Article prose does not use em dashes or en dashes. A pair around a phrase
// becomes parentheses. A single dash becomes a comma. Hyphens stay.

export function withoutEditorialDashes(text: string): string {
  const paired = text.replace(/[—–]([^—–]+)[—–]/g, " ($1) ");
  return paired
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}
