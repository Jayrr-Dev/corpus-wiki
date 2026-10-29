// Short dates in lists (AGENTS.md)
export const shortDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
