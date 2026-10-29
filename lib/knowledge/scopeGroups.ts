import type { ScopeOption } from "./scopeTypes";

// =====================================================================
// SCOPE GROUPS: how the scope picker files its choices into cards
// (components/knowledge/ScopePicker.tsx). A card is a group; opening it
// shows its rows as an indented tree.
//   Topic    a card per top-level topic, its sub-topics below it
//   Article  a card per top-level topic, articles under their topic's
//            headings; articles with no topic go under "No topic"
//   Entity   a card per type (Person, Organization), names below
// =====================================================================

// Topic labels and article groups are paths ("Acme › Health & Safety"); see loadScopeOptions
const SEPARATOR = " › ";
export const NO_TOPIC = "No topic";

// A row in an open card: a choice, or a heading (`id` null) that only labels the rows below it
export type ScopeRow = { id: string | null; name: string; depth: number };
export type ScopeGroup = { label: string; rows: ScopeRow[] };

// Topics: the top-level topic is the group's first row ("All of …")
export function topicGroups(topics: readonly ScopeOption[]): ScopeGroup[] {
  const groups = new Map<string, { segments: string[]; row: ScopeRow }[]>();
  for (const topic of topics) {
    const segments = topic.label.split(SEPARATOR);
    const root = segments[0] ?? topic.label;
    const depth = segments.length - 1;
    const name = depth ? segments[depth] ?? topic.label : `All of ${root}`;
    groups.set(root, [...(groups.get(root) ?? []), { segments, row: { id: topic.id, name, depth } }]);
  }
  return [...groups.entries()].map(([label, entries]) => ({
    label,
    rows: entries.sort((a, b) => compareSegments(a.segments, b.segments)).map((entry) => entry.row),
  }));
}

// Articles: those on the top-level topic first, then a heading per sub-topic with its articles below
export function articleGroups(articles: readonly ScopeOption[]): ScopeGroup[] {
  const byRoot = new Map<string, { below: string[]; article: ScopeOption }[]>();
  for (const article of articles) {
    const [root, ...below] = article.group ? article.group.split(SEPARATOR) : [NO_TOPIC];
    const key = root || NO_TOPIC;
    byRoot.set(key, [...(byRoot.get(key) ?? []), { below, article }]);
  }
  return sortGroups([...byRoot.entries()].map(([label, entries]) => {
    entries.sort((a, b) => compareSegments(a.below, b.below) || a.article.label.localeCompare(b.article.label));
    const rows: ScopeRow[] = [];
    const headed = new Set<string>();
    for (const { below, article } of entries) {
      below.forEach((name, index) => {
        const key = below.slice(0, index + 1).join(SEPARATOR);
        if (headed.has(key)) return;
        headed.add(key);
        rows.push({ id: null, name, depth: index });
      });
      rows.push({ id: article.id, name: article.label, depth: below.length });
    }
    return { label, rows };
  }));
}

// Entities: a group per type, names in order
export function entityGroups(entities: readonly ScopeOption[]): ScopeGroup[] {
  const byType = new Map<string, ScopeRow[]>();
  for (const entity of entities) {
    const type = entity.group || "Other";
    byType.set(type, [...(byType.get(type) ?? []), { id: entity.id, name: entity.label, depth: 0 }]);
  }
  return sortGroups([...byType.entries()].map(([label, rows]) => ({ label, rows: rows.sort((a, b) => a.name.localeCompare(b.name)) })));
}

// The value named most often; a tie goes to the one whose name sorts first (the graph's rule)
export function mostVoted(votes: readonly string[], nameOf: (vote: string) => string = (vote) => vote): string | null {
  const counts = new Map<string, number>();
  for (const vote of votes) counts.set(vote, (counts.get(vote) ?? 0) + 1);
  let best: string | null = null;
  for (const [vote, count] of counts) {
    const lead = best === null ? 1 : count - (counts.get(best) ?? 0) || nameOf(best).localeCompare(nameOf(vote));
    if (lead > 0) best = vote;
  }
  return best;
}

// Groups by name, "No topic" last
function sortGroups(groups: ScopeGroup[]): ScopeGroup[] {
  return groups.sort((a, b) => Number(a.label === NO_TOPIC) - Number(b.label === NO_TOPIC) || a.label.localeCompare(b.label));
}

// Parents before children: compare segment by segment, a shorter path first on a tie
function compareSegments(a: readonly string[], b: readonly string[]): number {
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const order = (a[index] ?? "").localeCompare(b[index] ?? "");
    if (order) return order;
  }
  return a.length - b.length;
}
