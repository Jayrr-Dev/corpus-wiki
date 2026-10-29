import { z } from "zod";

// =====================================================================
// DOC BLOCKS (docs/knowledge-modules-plan.md, section 2): what a Docs
// page is made of, in the style of task-based product docs. A doc page
// is a living page; each line of a doc section holds one block as JSON,
// so citations, stale marking and section rebuilds work as for articles.
//
//   text      a paragraph (the page intro, or prose inside a task)
//   heading   a sub-task (H3) inside a task section (H2)
//   steps     numbered steps with nested sub-steps
//   prereqs   the short Prerequisites step before CLI or API steps
//   code      a code block with <placeholder> values
//   params    the parameters a code block's placeholders stand for
//   callout   a Tip or a Warning
//   tabs      interface tabs (Web console, CLI, API), only when the
//             sources describe more than one way to do the task
//
// Every step, parameter and paragraph cites the claims (unit ids) it came
// from. Pure: shared by the writer, the export and the reader.
// =====================================================================

const cites = z.array(z.string().min(1)).default([]);

export type DocStep = { text: string; cites: string[]; substeps?: DocStep[] };
// Sub-steps nest one level in the reader; deeper levels still parse
const stepSchema = z.object({
  text: z.string(),
  cites,
  get substeps() { return z.array(stepSchema).optional(); },
});

export const docItemSchema = z.object({ text: z.string(), cites });
export const docParamSchema = z.object({ name: z.string(), description: z.string(), cites });
export type DocParam = z.infer<typeof docParamSchema>;

const textBlock = z.object({ type: z.literal("text"), text: z.string(), cites });
const headingBlock = z.object({ type: z.literal("heading"), text: z.string(), cites });
const stepsBlock = z.object({ type: z.literal("steps"), steps: z.array(stepSchema) });
const prereqsBlock = z.object({ type: z.literal("prereqs"), items: z.array(docItemSchema) });
const codeBlock = z.object({ type: z.literal("code"), language: z.string().default(""), code: z.string(), cites });
const paramsBlock = z.object({ type: z.literal("params"), params: z.array(docParamSchema) });
const calloutBlock = z.object({ type: z.literal("callout"), tone: z.enum(["tip", "warning"]), text: z.string(), cites });

// Blocks that may sit inside a tab (no tabs within tabs)
export const docInnerBlockSchema = z.discriminatedUnion("type", [textBlock, headingBlock, stepsBlock, prereqsBlock, codeBlock, paramsBlock, calloutBlock]);
export type DocInnerBlock = z.infer<typeof docInnerBlockSchema>;
const tabsBlock = z.object({ type: z.literal("tabs"), tabs: z.array(z.object({ label: z.string(), blocks: z.array(docInnerBlockSchema) })) });

export const docBlockSchema = z.discriminatedUnion("type", [textBlock, headingBlock, stepsBlock, prereqsBlock, codeBlock, paramsBlock, calloutBlock, tabsBlock]);
export type DocBlock = z.infer<typeof docBlockSchema>;
export type DocBlockType = DocBlock["type"];
export type DocTab = Extract<DocBlock, { type: "tabs" }>["tabs"][number];

// =====================================================================
// LINE CONTENT: one block as compact JSON. Anything that does not parse
// (a person's plain edit, an older line) reads as a paragraph, so the
// reader never loses words.
// =====================================================================

export function serializeDocBlock(block: DocBlock): string {
  return JSON.stringify(block);
}

// True when a line's content looks like a doc block (JSON with a type)
export function isDocBlockContent(content: string): boolean {
  return /^\s*\{\s*"type"\s*:/.test(content);
}

export function parseDocBlock(content: string): DocBlock {
  if (isDocBlockContent(content)) {
    try {
      const parsed = docBlockSchema.safeParse(JSON.parse(content));
      if (parsed.success) return parsed.data;
    } catch { /* falls through to a paragraph */ }
  }
  return { type: "text", text: content.trim(), cites: [] };
}

// =====================================================================
// CITATIONS AND TEXT
// =====================================================================

function stepCites(steps: readonly DocStep[]): string[] {
  return steps.flatMap((step) => [...step.cites, ...stepCites(step.substeps ?? [])]);
}

// Every claim a block cites, once, in reading order
export function docBlockCites(block: DocBlock): string[] {
  const all = (() => {
    switch (block.type) {
      case "text": case "heading": case "code": case "callout": return block.cites;
      case "steps": return stepCites(block.steps);
      case "prereqs": return block.items.flatMap((item) => item.cites);
      case "params": return block.params.flatMap((param) => param.cites);
      case "tabs": return block.tabs.flatMap((tab) => tab.blocks.flatMap(docBlockCites));
    }
  })();
  return [...new Set(all)];
}

function stepText(steps: readonly DocStep[]): string[] {
  return steps.flatMap((step) => [step.text, ...stepText(step.substeps ?? [])]);
}

// The block's words with no JSON, ids or step numbers: what the number check reads
export function docBlockText(block: DocBlock): string {
  switch (block.type) {
    case "text": case "heading": case "callout": return block.text;
    case "code": return block.code;
    case "steps": return stepText(block.steps).join("\n");
    case "prereqs": return block.items.map((item) => item.text).join("\n");
    case "params": return block.params.map((param) => `${param.name}: ${param.description}`).join("\n");
    case "tabs": return block.tabs.map((tab) => [tab.label, ...tab.blocks.map(docBlockText)].join("\n")).join("\n");
  }
}

// A line's words as a reader sees them: a doc block's text, any other line as it is (Composer prompts)
export function lineText(content: string): string {
  return isDocBlockContent(content) ? docBlockText(parseDocBlock(content)) : content;
}

// <placeholder> names in a code block, in order, once each
export function placeholdersIn(code: string): string[] {
  return [...new Set([...code.matchAll(/<([A-Za-z][\w.-]*)>/g)].map((match) => match[1]!))];
}

// =====================================================================
// NORMALIZE: what the writer returns becomes blocks the reader can trust.
// - cites keep only claims the section shows; uncited steps, params and
//   paragraphs are dropped (every line must come from a claim)
// - tabs appear only when the sources describe several ways: a tab must
//   cite a claim of its own, and fewer than two such tabs unwrap into
//   plain blocks
// - empty blocks disappear
// =====================================================================

function keepSteps(steps: readonly DocStep[], known: (ids: string[]) => string[]): DocStep[] {
  return steps.flatMap((step) => {
    const substeps = keepSteps(step.substeps ?? [], known);
    const ids = known(step.cites);
    if (!step.text.trim() || (!ids.length && !substeps.length)) return [];
    return [{ text: step.text.trim(), cites: ids, ...(substeps.length ? { substeps } : {}) }];
  });
}

function normalizeInner(block: DocInnerBlock, known: (ids: string[]) => string[]): DocInnerBlock[] {
  switch (block.type) {
    case "text": case "callout": {
      const ids = known(block.cites);
      return block.text.trim() && ids.length ? [{ ...block, text: block.text.trim(), cites: ids }] : [];
    }
    case "code": {
      const ids = known(block.cites);
      return block.code.trim() && ids.length ? [{ ...block, code: block.code.replace(/\s+$/, ""), cites: ids }] : [];
    }
    // A sub-task heading cites what its steps cite (filled in below when the writer left it out)
    case "heading": return block.text.trim() ? [{ type: "heading", text: block.text.trim(), cites: known(block.cites) }] : [];
    case "steps": {
      const steps = keepSteps(block.steps, known);
      return steps.length ? [{ type: "steps", steps }] : [];
    }
    case "prereqs": {
      const items = block.items.flatMap((item) => (item.text.trim() && known(item.cites).length ? [{ text: item.text.trim(), cites: known(item.cites) }] : []));
      return items.length ? [{ type: "prereqs", items }] : [];
    }
    case "params": {
      const params = block.params.flatMap((param) => (param.name.trim() && known(param.cites).length ? [{ name: param.name.trim().replace(/^<|>$/g, ""), description: param.description.trim(), cites: known(param.cites) }] : []));
      return params.length ? [{ type: "params", params }] : [];
    }
  }
}

// The section's blocks as the reader shows them; `unitIds` are the claims the section shows
export function normalizeDocBlocks(blocks: readonly DocBlock[], unitIds: Iterable<string>): DocBlock[] {
  const shown = new Set(unitIds);
  const known = (ids: string[]) => [...new Set(ids.filter((id) => shown.has(id)))];
  const kept = blocks.flatMap((block): DocBlock[] => {
    if (block.type !== "tabs") return normalizeInner(block, known);
    const tabs = block.tabs
      .map((tab) => ({ label: tab.label.trim(), blocks: tab.blocks.flatMap((inner) => normalizeInner(inner, known)) }))
      .filter((tab) => tab.label && tab.blocks.some((inner) => docBlockCites(inner).length > 0));
    // One way to do it: no tabs, just its steps
    if (tabs.length < 2) return tabs.flatMap((tab) => tab.blocks);
    return [{ type: "tabs", tabs }];
  });
  // A heading with no claims of its own cites the block under it; with nothing under it, it goes
  return kept.flatMap((block, index): DocBlock[] => {
    if (block.type !== "heading" || block.cites.length) return [block];
    const next = kept[index + 1];
    const ids = next && next.type !== "heading" ? docBlockCites(next) : [];
    return ids.length ? [{ ...block, cites: ids }] : [];
  });
}

// True when the blocks show interface tabs (for tests and the outline hint)
export const hasTabs = (blocks: readonly DocBlock[]) => blocks.some((block) => block.type === "tabs");
