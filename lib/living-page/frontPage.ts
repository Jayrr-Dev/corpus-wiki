import type { Tables } from "@/lib/database/types";
import { withoutEditorialDashes } from "@/lib/living-page/punctuation";

export type FrontArticle = Pick<Tables<"pages">, "id" | "title" | "slug" | "parent_page_id" | "domain_id"> & {
  excerpt: string;
  changedAt: string;
  sectionCount: number;
};
export type FrontSection = Pick<Tables<"sections">, "id" | "page_id" | "position" | "body" | "built_at" | "retired_at">;

// Use the user's configured calendar day, including while a tab stays open overnight.
export function editionDay(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function plainExcerpt(content: string, max = 800): string {
  const text = withoutEditorialDashes(content)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*[#>*-]+\s*/gm, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const clipped = text.slice(0, max);
  return `${clipped.slice(0, Math.max(clipped.lastIndexOf(" "), max - 25)).trimEnd()}…`;
}

export function buildFrontArticles(pages: Tables<"pages">[], sections: FrontSection[], changes: { section_id: string; last_changed_at: string }[] = []): FrontArticle[] {
  const grouped = new Map<string, FrontSection[]>();
  const changed = new Map<string, string>();
  for (const line of changes) {
    if (line.last_changed_at > (changed.get(line.section_id) ?? "")) changed.set(line.section_id, line.last_changed_at);
  }
  for (const section of sections.filter((s) => !s.retired_at).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))) {
    grouped.set(section.page_id, [...(grouped.get(section.page_id) ?? []), section]);
  }
  return pages.filter((page) => !page.retired_at).map((page) => {
    const content = grouped.get(page.id) ?? [];
    const changedAt = content.reduce((latest, section) => [latest, section.built_at ?? "", changed.get(section.id) ?? ""].sort().at(-1)!, page.created_at);
    return { ...page, excerpt: plainExcerpt(content.map((s) => s.body).join("\n\n")), changedAt, sectionCount: content.filter((s) => s.body.trim()).length };
  });
}

// Stable across refreshes and database ordering; the day advances the rotation.
export function dailyOrder<T extends { id: string }>(items: T[], day: string): T[] {
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
  if (!sorted.length) return sorted;
  const date = Date.parse(`${day}T12:00:00Z`);
  const offset = (Number.isFinite(date) ? Math.floor(date / 86_400_000) : 0) % sorted.length;
  return [...sorted.slice(offset), ...sorted.slice(0, offset)];
}

export function frontSelections(articles: FrontArticle[], day: string) {
  const readable = articles.filter((article) => article.excerpt.length >= 80);
  const substantial = readable.filter((article) => article.excerpt.length >= 300);
  const featured = dailyOrder(substantial.length ? substantial : readable, day)[0];
  const used = new Set(featured ? [featured.id] : []);
  const take = (items: FrontArticle[], count: number) => items.filter((a) => !used.has(a.id)).slice(0, count).map((a) => { used.add(a.id); return a; });
  const recent = take([...articles].sort((a, b) => b.changedAt.localeCompare(a.changedAt) || a.id.localeCompare(b.id)), 4);
  const discover = take(dailyOrder(readable, day), 3);
  const rediscover = take([...readable].sort((a, b) => a.changedAt.localeCompare(b.changedAt) || a.id.localeCompare(b.id)), 3);
  return { featured, recent, discover, rediscover };
}
