// PDF SECTIONS: the document outline (its bookmarks) names the part and chapter
// each page belongs to. A bookmark that is only "CHAPTER 6" takes its title from
// the first line of that chapter. Pages keep the latest section that has started.

const CHAPTER_BOOKMARK = /^chapter\s+\d+$/i;
const TITLE_MAX_CHARS = 80;
const TITLE_SCAN_LINES = 12;

type OutlineDest = string | unknown[] | null;

type OutlineNode = {
  title: string;
  dest: OutlineDest;
  items?: OutlineNode[];
};

// The outline calls pdf.js already exposes. A missing or broken outline leaves pages unsectioned.
export type PdfOutlineSource = {
  getOutline(): Promise<OutlineNode[] | null>;
  getDestination(name: string): Promise<unknown[] | null>;
  getPageIndex(ref: unknown): Promise<number>;
};

type SectionMark = { page: number; path: string[] };

// One path per page, in page order. Undefined until the first bookmark.
export async function bookSectionPaths(pdf: PdfOutlineSource, pageTexts: readonly string[]): Promise<(string[] | undefined)[]> {
  try {
    const outline = await pdf.getOutline();
    const marks = await sectionMarks(pdf, outline ?? [], [], pageTexts);
    return pathsForPages(marks, pageTexts.length);
  } catch {
    return pageTexts.map(() => undefined);
  }
}

async function sectionMarks(pdf: PdfOutlineSource, nodes: readonly OutlineNode[], parents: readonly string[], pageTexts: readonly string[]): Promise<SectionMark[]> {
  const marks: SectionMark[] = [];
  for (const node of nodes) {
    const title = node.title.trim();
    const page = title ? await bookmarkPage(pdf, node.dest) : null;
    const path = page === null ? parents : [...parents, ...sectionTitles(title, pageTexts[page - 1])];
    if (page !== null) marks.push({ page, path: [...path] });
    marks.push(...await sectionMarks(pdf, node.items ?? [], path, pageTexts));
  }
  return marks;
}

// A chapter bookmark stays "CHAPTER 6" and gains the title printed under it.
function sectionTitles(title: string, pageText: string | undefined): string[] {
  const subtitle = CHAPTER_BOOKMARK.test(title) ? chapterSubtitle(pageText, title) : null;
  return subtitle ? [title, subtitle] : [title];
}

function chapterSubtitle(pageText: string | undefined, bookmarkTitle: string): string | null {
  if (!pageText) return null;
  const label = bookmarkTitle.trim().replace(/\s+/g, " ").toLowerCase();
  const lines = pageText.split(/\n/).map((line) => line.trim()).filter((line) => line.length > 0).slice(0, TITLE_SCAN_LINES);
  const index = lines.findIndex((line) => labelStarts(line.replace(/\s+/g, " ").toLowerCase(), label));
  if (index < 0) return null;
  const line = lines[index]!.replace(/\s+/g, " ");
  const remainder = line.slice(line.toLowerCase().indexOf(label) + label.length).trim().replace(/^[:.\-–—]\s*/, "");
  const candidate = remainder.length > 0 ? remainder : lines[index + 1];
  return candidate ? shortTitle(candidate) : null;
}

function labelStarts(line: string, label: string): boolean {
  if (line === label) return true;
  if (!line.startsWith(label)) return false;
  const next = line[label.length];
  return next === " " || next === ":" || next === "." || next === "-" || next === "–" || next === "—";
}

function shortTitle(value: string): string | null {
  const title = value.replace(/\s+/g, " ").trim();
  if (title.length === 0 || title.length > TITLE_MAX_CHARS) return null;
  if (/[.!?]$/.test(title)) return null;
  if (CHAPTER_BOOKMARK.test(title)) return null;
  return title;
}

async function bookmarkPage(pdf: PdfOutlineSource, dest: OutlineDest | undefined): Promise<number | null> {
  try {
    const explicit = Array.isArray(dest) ? dest : null;
    const named = typeof dest === "string" ? await pdf.getDestination(dest) : null;
    const ref = (explicit ?? named)?.[0];
    if (ref == null) return null;
    const index = await pdf.getPageIndex(ref);
    return index >= 0 ? index + 1 : null;
  } catch {
    return null;
  }
}

// The last bookmark that has already started owns the page. Outline order is reading order.
export function pathsForPages(marks: readonly SectionMark[], pageCount: number): (string[] | undefined)[] {
  return Array.from({ length: pageCount }, (_, index) => {
    const page = index + 1;
    let path: string[] | undefined;
    for (const mark of marks) {
      if (mark.page <= page) path = mark.path;
    }
    return path;
  });
}
