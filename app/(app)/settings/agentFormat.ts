// A short date and time for agent rows ("Oct 28, 2026, 3:42 PM"), or `empty` when there is none
export function formatWhen(value: string | null, empty = ""): string {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : empty;
}
