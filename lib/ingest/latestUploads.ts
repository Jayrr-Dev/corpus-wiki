// A re-run is processing history for the same file, not another uploaded file.
export function latestUploads<T extends { source_id: string | null; created_at: string }>(events: readonly T[]): T[] {
  const latest = new Map<string, T>();
  for (const event of events) {
    if (!event.source_id) continue;
    const previous = latest.get(event.source_id);
    if (!previous || Date.parse(event.created_at) > Date.parse(previous.created_at)) latest.set(event.source_id, event);
  }
  return [...latest.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}
