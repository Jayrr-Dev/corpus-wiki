import type { ShownIllustration } from "@/lib/composer/types";

// Current sections only. Unmatched drawings belong in history, not the article.
export function illustrationSections<T extends { id: string; title: string; position: number }>(sections: T[], figures: ShownIllustration[]) {
  const outline = new Map<string, { id: string; title: string; position: number; section: T; figures: ShownIllustration[] }>(
    sections.map((section) => [section.id, { ...section, section, figures: [] }]),
  );
  for (const figure of figures) {
    const entry = figure.sectionId ? outline.get(figure.sectionId) : undefined;
    if (entry) entry.figures.push(figure);
  }
  return [...outline.values()].sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}
