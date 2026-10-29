import { type DocBlock, type DocInnerBlock, type DocStep, parseDocBlock } from "./blocks";
import type { DocSetView } from "./types";

// =====================================================================
// MARKDOWN EXPORT: a doc set as one Markdown file per page (Export in the
// reader's top bar). Steps stay numbered, sub-steps indent, code keeps its
// <placeholders>, callouts become "> **Tip:**" quotes and each tab becomes
// a bold label over its own steps. Citations stay in the app.
// =====================================================================

// What the export reads: a page's sections, each a list of line contents in order
export type DocExportSection = { title: string; intro?: boolean; lines: string[] };
export type DocExportPage = { title: string; sections: DocExportSection[] };

function stepsMarkdown(steps: readonly DocStep[], depth = 0): string {
  const indent = "   ".repeat(depth);
  return steps.map((step, index) => {
    const own = `${indent}${index + 1}. ${step.text}`;
    return step.substeps?.length ? `${own}\n${stepsMarkdown(step.substeps, depth + 1)}` : own;
  }).join("\n");
}

function fence(code: string): string {
  // A fence longer than any backtick run inside the code
  const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((match) => match[0].length));
  return "`".repeat(longest + 1);
}

function innerMarkdown(block: DocInnerBlock): string {
  switch (block.type) {
    case "text": return block.text;
    case "heading": return `### ${block.text}`;
    case "steps": return stepsMarkdown(block.steps);
    case "prereqs": return ["**Prerequisites**", "", ...block.items.map((item) => `- ${item.text}`)].join("\n");
    case "code": {
      const marks = fence(block.code);
      return `${marks}${block.language}\n${block.code}\n${marks}`;
    }
    case "params": return block.params.map((param) => `- \`${param.name}\`: ${param.description}`).join("\n");
    case "callout": return `> **${block.tone === "tip" ? "Tip" : "Warning"}:** ${block.text}`;
  }
}

export function docBlockMarkdown(block: DocBlock): string {
  if (block.type !== "tabs") return innerMarkdown(block);
  return block.tabs.map((tab) => [`**${tab.label}**`, ...tab.blocks.map(innerMarkdown)].join("\n\n")).join("\n\n");
}

// One page: H1 title, the intro, then each task as H2
export function docPageMarkdown(page: DocExportPage): string {
  const parts = [`# ${page.title}`];
  for (const section of page.sections) {
    const blocks = section.lines.map(parseDocBlock).map(docBlockMarkdown).filter((text) => text.trim());
    if (!section.intro) parts.push(`## ${section.title}`);
    parts.push(...blocks);
  }
  return `${parts.join("\n\n")}\n`;
}

// "Create a cluster" → "create-a-cluster"
export function docSlug(title: string): string {
  return title.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "page";
}

// The files of the export: one per page in tree order, numbered so they sort, plus an index
export function docSetMarkdownFiles(title: string, pages: readonly DocExportPage[]): { name: string; content: string }[] {
  const width = String(pages.length).length < 2 ? 2 : String(pages.length).length;
  const files = pages.map((page, index) => ({ name: `${String(index + 1).padStart(width, "0")}-${docSlug(page.title)}.md`, content: docPageMarkdown(page) }));
  const index = [`# ${title}`, "", ...files.map((file, at) => `${at + 1}. [${pages[at]!.title}](${file.name})`)].join("\n");
  return [{ name: "README.md", content: `${index}\n` }, ...files];
}

// The export of a doc set as the reader loads it (read_doc_set)
export function docSetExportFiles(set: Pick<DocSetView, "title" | "pages">): { name: string; content: string }[] {
  return docSetMarkdownFiles(set.title, set.pages.map((page) => ({
    title: page.title,
    sections: page.sections.map((section) => ({ title: section.title, intro: section.intro, lines: section.lines.map((line) => line.content) })),
  })));
}
