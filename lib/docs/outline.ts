import { z } from "zod";

// =====================================================================
// DOC OUTLINE: the pages a doc set will have, before anything is written.
// The Docs writer proposes it from the scope's claims (lib/docs/generate.ts);
// the New docs dialog lets a person rename, reorder or drop pages; then
// each page becomes a living page whose sections are its tasks.
// Pages are grouped by task: set up, use, change, remove.
// Pure: shared by the server and the dialog.
// =====================================================================

export const OUTLINE_GROUPS = ["set_up", "use", "change", "remove"] as const;
export type OutlineGroup = (typeof OUTLINE_GROUPS)[number];
export const OUTLINE_GROUP_LABELS: Record<OutlineGroup, string> = { set_up: "Set up", use: "Use", change: "Change", remove: "Remove" };

export const MAX_OUTLINE_PAGES = 20;
export const MAX_PAGE_SECTIONS = 8;

// A task on a page (an H2), with the claims it is written from
const outlineSectionSchema = z.object({ title: z.string(), unitIds: z.array(z.string()) });
// A page: its title, its group, the claims for its intro and its tasks
const outlinePageSchema = z.object({
  title: z.string(),
  group: z.enum(OUTLINE_GROUPS),
  introUnitIds: z.array(z.string()).default([]),
  sections: z.array(outlineSectionSchema),
});
export const docOutlineSchema = z.object({ title: z.string(), pages: z.array(outlinePageSchema) });

export type OutlineSection = z.infer<typeof outlineSectionSchema>;
export type OutlinePage = z.infer<typeof outlinePageSchema>;
export type DocOutline = z.infer<typeof docOutlineSchema>;

// What the model answers (no defaults, so the JSON schema stays strict)
export const outlineAnswerSchema = z.object({
  title: z.string(),
  pages: z.array(z.object({
    title: z.string(),
    group: z.enum(OUTLINE_GROUPS),
    introUnitIds: z.array(z.string()),
    sections: z.array(outlineSectionSchema),
  })),
});

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

// NORMALIZE: only scope claims, each used once (first place wins); empty tasks and
// pages go; titles are unique per set; pages sort by group, keeping their order within it
export function normalizeOutline(outline: DocOutline, scopeUnitIds: Iterable<string>, fallbackTitle = "Docs"): DocOutline {
  const allowed = new Set(scopeUnitIds);
  const used = new Set<string>();
  const take = (ids: readonly string[]) => ids.filter((id) => allowed.has(id) && !used.has(id) && used.add(id));
  const titles = new Set<string>();
  const pages: OutlinePage[] = [];
  for (const page of outline.pages) {
    const title = clean(page.title);
    if (!title || titles.has(title.toLowerCase())) continue;
    const introUnitIds = take(page.introUnitIds ?? []);
    const sectionTitles = new Set<string>();
    const sections = page.sections.flatMap((section) => {
      const name = clean(section.title);
      const unitIds = take(section.unitIds);
      if (!name || !unitIds.length || sectionTitles.has(name.toLowerCase())) return [];
      sectionTitles.add(name.toLowerCase());
      return [{ title: name, unitIds }];
    }).slice(0, MAX_PAGE_SECTIONS);
    if (!sections.length && !introUnitIds.length) continue;
    titles.add(title.toLowerCase());
    // A page with no tasks would be an intro paragraph only: its claims become the page's one task,
    // written as steps (the reader leaves out a task heading that repeats the page title)
    const onlyIntro = !sections.length;
    pages.push({ title, group: OUTLINE_GROUPS.includes(page.group) ? page.group : "use", introUnitIds: onlyIntro ? [] : introUnitIds, sections: onlyIntro ? [{ title, unitIds: introUnitIds }] : sections });
  }
  const order = (group: OutlineGroup) => OUTLINE_GROUPS.indexOf(group);
  const sorted = pages.map((page, index) => ({ page, index })).sort((a, b) => order(a.page.group) - order(b.page.group) || a.index - b.index).map(({ page }) => page);
  return { title: clean(outline.title) || fallbackTitle, pages: sorted.slice(0, MAX_OUTLINE_PAGES) };
}

// A PERSON'S EDITS in the dialog: the pages to keep, in the order to keep them, with their titles
export type OutlineEdit = { index: number; title: string }[];

// Applies the dialog's rename / reorder / drop to the proposed outline. Unknown indexes are
// ignored and a page cannot appear twice; the claims stay with the page they were proposed for.
export function applyOutlineEdits(outline: DocOutline, edits: OutlineEdit): DocOutline {
  const seen = new Set<number>();
  const pages = edits.flatMap(({ index, title }) => {
    const page = outline.pages[index];
    if (!page || seen.has(index)) return [];
    seen.add(index);
    return [{ ...page, title: clean(title) || page.title }];
  });
  return { ...outline, pages };
}

// Moves one page up (-1) or down (+1) in an edit list
export function movePage(edits: OutlineEdit, at: number, by: -1 | 1): OutlineEdit {
  const to = at + by;
  if (to < 0 || to >= edits.length) return edits;
  const next = [...edits];
  [next[at], next[to]] = [next[to]!, next[at]!];
  return next;
}

// A FALLBACK OUTLINE (no AI configured): one page, its intro from the first claim and
// tasks of up to six claims each, in the scope's order (most central first)
export function fallbackOutline(title: string, unitIds: readonly string[]): DocOutline {
  const [intro, ...rest] = unitIds;
  const sections: OutlineSection[] = [];
  for (let at = 0; at < rest.length; at += 6) sections.push({ title: sections.length ? `Tasks, part ${sections.length + 1}` : "Tasks", unitIds: rest.slice(at, at + 6) });
  return { title, pages: intro ? [{ title, group: "use", introUnitIds: [intro], sections }] : [] };
}

// Claims the outline leaves out (shown as a count in the dialog)
export function outlineUnitIds(outline: DocOutline): string[] {
  return outline.pages.flatMap((page) => [...page.introUnitIds, ...page.sections.flatMap((section) => section.unitIds)]);
}
