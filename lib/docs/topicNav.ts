import type { ScopeOptions } from "@/lib/knowledge/scopeTypes";
import type { DocSetSummary } from "./types";

// =====================================================================
// DOCS TOPIC NAV: the bar of topic buttons over Docs, like MDN's "HTML,
// CSS, JavaScript" bar. A button is a second-level topic that has docs
// (Health & Safety under Brightwater); the top level (the company, like
// MDN's "Web") is never a button. Its menu lists the doc sets by the
// sub-topics below it (Confined Space Entry). Second-level topics with
// the same name under different companies share one button. Sets on a
// top-level topic itself, or on a topic that is gone, go under "Other
// topics"; sets on an article, an entity or the glossary get a button
// per kind.
// =====================================================================

const SEPARATOR = " › ";
const KIND_BUTTONS = { article: "Articles", entity: "Entities", glossary: "Glossary" } as const;
const OTHER_TOPICS = "topic:";

export type TopicNavSet = { id: string; title: string };
export type TopicNavSection = { label: string | null; sets: TopicNavSet[] };
// topicId: the button's own topic, so "New docs" can start from it (null for Other topics and the kind buttons)
export type TopicNavItem = { key: string; label: string; topicId: string | null; sections: TopicNavSection[] };

type NavSet = Pick<DocSetSummary, "id" | "title" | "scopeKind" | "scopeId">;

export function docsTopicNav(sets: readonly NavSet[], options: Pick<ScopeOptions, "topic">): TopicNavItem[] {
  const topicPaths = new Map(options.topic.map((option) => [option.id, option.label.split(SEPARATOR)]));
  // a shared name (Health & Safety under two companies) has no single topic for New docs to start from
  const buttonTopic = new Map<string, string | null>();
  for (const [id, path] of topicPaths) if (path.length === 2 && path[1]) buttonTopic.set(path[1], buttonTopic.has(path[1]) ? null : id);

  const items = new Map<string, { label: string; topicId: string | null; sections: Map<string, TopicNavSection> }>();
  for (const set of sets) {
    const path = set.scopeKind === "topic" && set.scopeId ? topicPaths.get(set.scopeId) : undefined;
    const button = path?.[1];
    const [key, label] = button ? [`topic:${button}`, button]
      : set.scopeKind === "topic" ? [OTHER_TOPICS, "Other topics"]
      : [set.scopeKind, KIND_BUTTONS[set.scopeKind]];
    const item = items.get(key) ?? { label, topicId: button ? buttonTopic.get(button) ?? null : null, sections: new Map() };
    items.set(key, item);
    const section = button && path ? path.slice(2).join(SEPARATOR) || null : null;
    const entry = item.sections.get(section ?? "") ?? { label: section, sets: [] };
    item.sections.set(section ?? "", entry);
    entry.sets.push({ id: set.id, title: set.title });
  }

  const byLabel = (a: string, b: string) => a.localeCompare(b);
  const topicsFirst = (key: string) => (key === OTHER_TOPICS ? 1 : key.startsWith("topic:") ? 0 : 2);
  return [...items.entries()]
    .sort(([a, x], [b, y]) => topicsFirst(a) - topicsFirst(b) || byLabel(x.label, y.label))
    .map(([key, item]) => ({
      key,
      label: item.label,
      topicId: item.topicId,
      sections: [...item.sections.values()].sort((a, b) => (a.label === null ? -1 : b.label === null ? 1 : byLabel(a.label, b.label))),
    }));
}

// The button a set sits under, to mark it while reading that set
export function topicNavKeyFor(items: readonly TopicNavItem[], setId: string): string | null {
  return items.find((item) => item.sections.some((section) => section.sets.some((set) => set.id === setId)))?.key ?? null;
}

// The ids of the sets under one button, to filter the Docs list by ?topic=
export function topicNavSetIds(items: readonly TopicNavItem[], key: string): Set<string> | null {
  const item = items.find((entry) => entry.key === key);
  return item ? new Set(item.sections.flatMap((section) => section.sets.map((set) => set.id))) : null;
}
