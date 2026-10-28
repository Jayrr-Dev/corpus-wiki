import { type GraphNodeKind, isContent } from "./nodeTypes";

// Green and yellow rings mark this share of each set, the ones touched most recently.
export const RECENT_SHARE = 0.1;

// How many of a set to mark. A set smaller than five still marks its newest one.
export function recentLimit(total: number, share = RECENT_SHARE): number {
  if (total <= 0) return 0;
  return Math.max(1, Math.round(total * share));
}

// Ids of the knowledge units with the latest activity time. A tie keeps the
// lower id so the same units stay marked between frames.
export function recentUnitIds(
  nodes: readonly { id: string; kind: GraphNodeKind; activityAt?: string }[],
  share = RECENT_SHARE,
): Set<string> {
  const ranked: { id: string; at: number }[] = [];
  for (const node of nodes) {
    if (!isContent(node) || !node.activityAt) continue;
    const at = Date.parse(node.activityAt);
    if (!Number.isFinite(at)) continue;
    ranked.push({ id: node.id, at });
  }
  ranked.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  return new Set(
    ranked.slice(0, recentLimit(ranked.length, share)).map((row) => row.id),
  );
}

// Keys of the newest articles or sections. Same share and tie-break as units.
export function recentMarkedKeys(
  items: readonly { key: string; at?: string }[],
  share = RECENT_SHARE,
): Set<string> {
  const ranked: { key: string; at: number }[] = [];
  for (const item of items) {
    if (!item.at) continue;
    const at = Date.parse(item.at);
    if (!Number.isFinite(at)) continue;
    ranked.push({ key: item.key, at });
  }
  ranked.sort((a, b) => b.at - a.at || a.key.localeCompare(b.key));
  return new Set(
    ranked.slice(0, recentLimit(ranked.length, share)).map((row) => row.key),
  );
}
