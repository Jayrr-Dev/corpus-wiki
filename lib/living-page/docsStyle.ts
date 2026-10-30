import { z } from "zod";
import { chatJson, type TokenFactorySettings } from "@/lib/ai/chat";
import { DOCS_WRITER_INSTRUCTIONS } from "@/lib/ai/rolePolicies";
import { type DocBlock, type DocInnerBlock, docBlockCites, normalizeDocBlocks, parseDocBlock, serializeDocBlock } from "@/lib/docs/blocks";
import type { SectionProgress } from "./buildProgress";
import type { SectionWriter } from "./index";
import type { LineText, SectionReviseInput, SectionRevision, SectionState } from "./types";

// =====================================================================
// DOCS SECTION STYLE (docs/knowledge-modules-plan.md, section 2): a Docs
// page is a living page whose sections carry query.style = "doc". Their
// lines hold doc blocks (lib/docs/blocks.ts) instead of prose, written by
// the Docs writer role. Everything else is the living page as it is:
// claims come from the section query, each line cites the claims it states,
// a changed claim flags its lines and the next build rewrites only those,
// and the answer is committed through Change control.
// =====================================================================

export const DOCS_PROMPT_VERSION = "docs-writer-v2";
export const DOCS_FAKE_MODEL = "fake-docs";

// The style a section's query asks for (null: an article section)
export function sectionStyle(state: Pick<SectionState, "query">): SectionReviseInput["style"] | null {
  return state.query?.style === "doc" ? { kind: "doc", intro: state.query.docPart === "intro" } : null;
}

// =====================================================================
// THE MODEL'S ANSWER: one flat block shape (every field present, empty
// when unused) so structured output stays simple; converted to typed
// blocks and normalized before anything is saved.
// =====================================================================

const cited = z.object({ text: z.string(), cites: z.array(z.string()) });
const answerInner = z.object({
  type: z.enum(["text", "heading", "steps", "prereqs", "code", "params", "callout"]),
  text: z.string(),
  cites: z.array(z.string()),
  tone: z.enum(["tip", "warning", "none"]),
  language: z.string(),
  code: z.string(),
  steps: z.array(cited.extend({ substeps: z.array(cited) })),
  items: z.array(cited),
  params: z.array(z.object({ name: z.string(), description: z.string(), cites: z.array(z.string()) })),
});
const answerBlock = answerInner.extend({
  type: z.enum(["text", "heading", "steps", "prereqs", "code", "params", "callout", "tabs"]),
  tabs: z.array(z.object({ label: z.string(), blocks: z.array(answerInner) })),
});
export const docsAnswerSchema = z.object({
  revise: z.array(z.object({ lineId: z.string(), blocks: z.array(answerBlock) })),
  retire: z.array(z.string()),
  add: z.array(answerBlock),
});
export type DocsAnswer = z.infer<typeof docsAnswerSchema>;
export type DocsAnswerBlock = z.infer<typeof answerBlock>;

// The schema the model must follow for one section. Left free to choose, Nemotron wrote every task
// as one summary paragraph, so a task may not use text blocks (steps carry the how-to) and the
// intro may use only text blocks.
const TASK_TYPES = ["heading", "steps", "prereqs", "code", "params", "callout"] as const;
export function sectionAnswerSchema(intro: boolean) {
  const inner = answerInner.extend({ type: intro ? z.enum(["text"]) : z.enum(TASK_TYPES) });
  // every block keeps the tabs field (empty when unused) so the answer still parses as docsAnswerSchema
  const block = inner.extend({ type: intro ? z.enum(["text"]) : z.enum([...TASK_TYPES, "tabs"]), tabs: z.array(z.object({ label: z.string(), blocks: z.array(inner) })) });
  return z.object({ revise: z.array(z.object({ lineId: z.string(), blocks: z.array(block) })), retire: z.array(z.string()), add: z.array(block) });
}
const INTRO_ANSWER_SCHEMA = sectionAnswerSchema(true);
const TASK_ANSWER_SCHEMA = sectionAnswerSchema(false);

function innerFromAnswer(block: z.infer<typeof answerInner>): DocInnerBlock {
  switch (block.type) {
    case "text": return { type: "text", text: block.text, cites: block.cites };
    case "heading": return { type: "heading", text: block.text, cites: block.cites };
    case "steps": return { type: "steps", steps: block.steps.map((step) => ({ text: step.text, cites: step.cites, ...(step.substeps.length ? { substeps: step.substeps.map((sub) => ({ text: sub.text, cites: sub.cites })) } : {}) })) };
    case "prereqs": return { type: "prereqs", items: block.items };
    case "code": return { type: "code", language: block.language, code: block.code, cites: block.cites };
    case "params": return { type: "params", params: block.params };
    case "callout": return { type: "callout", tone: block.tone === "warning" ? "warning" : "tip", text: block.text, cites: block.cites };
  }
}

export function blockFromAnswer(block: DocsAnswerBlock): DocBlock {
  if (block.type === "tabs") return { type: "tabs", tabs: block.tabs.map((tab) => ({ label: tab.label, blocks: tab.blocks.map(innerFromAnswer) })) };
  return innerFromAnswer({ ...block, type: block.type });
}

// THE MODEL SEAM: production calls the Docs writer role (purpose "docs_page"); tests pass a mock
export type DocsModelRequest = { system: string; user: string; subject: string; intro: boolean };
export type DocsModel = (request: DocsModelRequest) => Promise<{ value: DocsAnswer; model: string; tokensIn: number | null; tokensOut: number | null }>;

export function chatDocsModel(settings: TokenFactorySettings): DocsModel {
  return (request) => chatJson(settings, {
    name: "docs_page",
    subject: request.subject,
    schema: docsAnswerSchema,
    jsonSchema: z.toJSONSchema(request.intro ? INTRO_ANSWER_SCHEMA : TASK_ANSWER_SCHEMA),
    maxTokens: 12_000,
    messages: [{ role: "system", content: request.system }, { role: "user", content: request.user }],
  });
}

const FORMAT_RULES = `Answer with doc blocks. Block types:
- text: a paragraph (text, cites). The intro section is one text block that says what the subject is.
- heading: a sub-task title inside this task (text).
- steps: numbered steps (steps: text, cites, substeps).
- prereqs: the short Prerequisites step before command-line or API steps (items).
- code: a code block (language, code). Write values the reader must fill in as <placeholder>.
- params: right after a code block, one entry per <placeholder> (name without brackets, description, cites).
- callout: tone tip or warning, used sparingly (text, cites).
- tabs: interface tabs (label such as Web console, CLI or API; blocks). Use tabs only when the claims describe more than one way to do the task; with one way, write the steps without tabs.
A task section (not the intro) is how-to content and has no text blocks: write a steps block, one numbered step per action in the order the reader does them, each starting with a verb ("Ventilate the space for at least 15 minutes."). Use callouts for safety limits or easy mistakes. Never copy a claim's wording as a block; a claim that names a tool or record becomes the step that uses it.
Every block lists in cites the unitIds of the claims it states. State nothing the claims do not support, and keep their numbers exactly.
Rewrite only the lines marked needsRewrite (revise them, or retire them when their claims are gone) and write blocks for uncoveredUnitIds (add). Fields a block type does not use are empty.`;

// The section as the model sees it
function docsRequest(input: SectionReviseInput): DocsModelRequest {
  const intro = input.style?.intro === true;
  const user = JSON.stringify({
    page: input.pageTitle,
    section: intro ? "(intro)" : input.sectionTitle,
    claims: input.units.map((unit) => ({ unitId: unit.unitId, kind: unit.kind, content: unit.content })),
    lines: input.lines.map((line) => ({ lineId: line.lineId, needsRewrite: line.needsRewrite, block: parseDocBlock(line.content) })),
    uncoveredUnitIds: input.uncoveredUnitIds,
    ...(input.pageContext?.length ? { otherSections: input.pageContext } : {}),
  });
  return { system: `${DOCS_WRITER_INSTRUCTIONS}\n${FORMAT_RULES}`, user, subject: `${input.pageTitle} › ${intro ? "Intro" : input.sectionTitle}`, intro };
}

// =====================================================================
// THE DOCS WRITER: a SectionWriter, so rebuildSection, rebuildPage and
// rebuildAfterEvent drive it like the article writer. Without a model it
// writes deterministic blocks from the claims' own text (dev and tests).
// =====================================================================

export class DocsSectionWriter implements SectionWriter {
  readonly name = "docs";
  readonly promptVersion = DOCS_PROMPT_VERSION;
  constructor(private readonly model: DocsModel | null) {}

  async reviseSection(input: SectionReviseInput, progress?: SectionProgress): Promise<SectionRevision> {
    if (!this.model) return fakeDocsRevision(input);
    progress?.step("Writing doc steps…");
    const request = docsRequest(input);
    const unitIds = input.units.map((unit) => unit.unitId);
    let answer = await this.model(request);
    // A task with claims to write must come back as steps that survive normalization (steps citing
    // unknown claims are dropped). Nemotron tends to answer with a lone heading, a paragraph or
    // miscited steps: ask once more, then fall back to one cited step per claim.
    if (!request.intro && input.uncoveredUnitIds.length && !answerHasSteps(answer.value, unitIds)) {
      answer = await this.model({ ...request, user: `${request.user}\n\nYour last answer had no usable steps block. Write this task as a steps block: one numbered step per action, each citing the unitIds (from claims) it states.` });
      if (!answerHasSteps(answer.value, unitIds)) return fakeDocsRevision(input);
    }
    const flagged = new Set(input.lines.filter((line) => line.needsRewrite).map((line) => line.lineId));
    const toLines = (blocks: DocsAnswerBlock[]): LineText[] =>
      normalizeDocBlocks(blocks.map(blockFromAnswer), unitIds).map((block) => ({ text: serializeDocBlock(block), unitIds: docBlockCites(block) }));
    const revise: SectionRevision["revise"] = [];
    const retire = new Set(answer.value.retire.filter((id) => flagged.has(id)));
    const add: LineText[] = [];
    for (const item of answer.value.revise) {
      if (!flagged.has(item.lineId) || retire.has(item.lineId)) continue;
      const [first, ...more] = toLines(item.blocks);
      if (!first) { retire.add(item.lineId); continue; }
      revise.push({ lineId: item.lineId, ...first });
      add.push(...more);
    }
    add.push(...toLines(answer.value.add));
    // Nothing usable for knowledge the section has to state (an intro citing no real claim): the plain version
    if (!revise.length && !add.length && input.uncoveredUnitIds.length) return fakeDocsRevision(input);
    return withOmissions(input, { revise, retire: [...retire], add, modelVersion: answer.model, tokensIn: answer.tokensIn, tokensOut: answer.tokensOut });
  }
}

// True when the answer keeps at least one step once normalized against the section's claims,
// directly or inside interface tabs
export function answerHasSteps(answer: DocsAnswer, unitIds: readonly string[]): boolean {
  const blocks = normalizeDocBlocks([...answer.add, ...answer.revise.flatMap((item) => item.blocks)].map(blockFromAnswer), unitIds);
  return blocks.some((block) => block.type === "steps" || (block.type === "tabs" && block.tabs.some((tab) => tab.blocks.some((inner) => inner.type === "steps"))));
}

// Claims no line will cite are left out on purpose ("leave out anything no claim supports"),
// so the section stops trying to write them; the claims themselves stay
function withOmissions(input: SectionReviseInput, revision: SectionRevision): SectionRevision {
  const changed = new Set([...revision.retire, ...revision.revise.map((line) => line.lineId)]);
  const cited = new Set([
    ...input.lines.filter((line) => !changed.has(line.lineId)).flatMap((line) => line.unitIds),
    ...revision.revise.flatMap((line) => line.unitIds),
    ...revision.add.flatMap((line) => line.unitIds),
  ]);
  const omittedUnitIds = input.units.map((unit) => unit.unitId).filter((id) => !cited.has(id));
  return omittedUnitIds.length ? { ...revision, omittedUnitIds } : revision;
}

// FAKE: the intro is one paragraph of its claims; a task is one numbered step per claim
export function fakeDocsRevision(input: SectionReviseInput): SectionRevision {
  const contentOf = new Map(input.units.map((unit) => [unit.unitId, unit.content.trim()]));
  const blockFor = (ids: string[]): DocBlock => input.style?.intro
    ? { type: "text", text: ids.map((id) => contentOf.get(id)).join(" "), cites: ids }
    : { type: "steps", steps: ids.map((id) => ({ text: contentOf.get(id) ?? "", cites: [id] })) };
  const line = (ids: string[]): LineText => ({ text: serializeDocBlock(blockFor(ids)), unitIds: ids });
  const flagged = input.lines.filter((item) => item.needsRewrite).map((item) => ({ lineId: item.lineId, unitIds: item.unitIds.filter((id) => contentOf.has(id)) }));
  return {
    revise: flagged.filter((item) => item.unitIds.length).map((item) => ({ lineId: item.lineId, ...line(item.unitIds) })),
    retire: flagged.filter((item) => !item.unitIds.length).map((item) => item.lineId),
    add: input.uncoveredUnitIds.length ? [line(input.uncoveredUnitIds)] : [],
    modelVersion: DOCS_FAKE_MODEL,
  };
}

// =====================================================================
// STYLE ROUTER: one SectionWriter for the server deps. Docs sections go to
// the Docs writer and skip the article editorial review (it polishes prose
// and would not keep a doc block's JSON); every other section is unchanged.
// =====================================================================

type Review = NonNullable<SectionWriter["reviewSections"]>;

class StyledSectionWriter implements SectionWriter {
  progress?: (sectionId: string) => SectionProgress;
  private review?: Review;
  private readonly docSections = new Set<string>();
  constructor(private readonly article: SectionWriter, private readonly docs: SectionWriter) {}

  get name() { return this.article.name; }
  get promptVersion() { return this.article.promptVersion; }

  async prepareSection(state: SectionState): Promise<SectionState> {
    if (sectionStyle(state)) {
      this.docSections.add(state.sectionId);
      return this.docs.prepareSection ? this.docs.prepareSection(state) : state;
    }
    return this.article.prepareSection ? this.article.prepareSection(state) : state;
  }

  reviseSection(input: SectionReviseInput, progress?: SectionProgress): Promise<SectionRevision> {
    const writer = input.style?.kind === "doc" ? this.docs : this.article;
    return progress ? writer.reviseSection(input, progress) : writer.reviseSection(input);
  }

  // The server deps set the editorial review after building the writer
  get reviewSections(): Review | undefined {
    const review = this.review;
    if (!review) return undefined;
    return async (sectionIds, checkpointScope) => {
      const prose = sectionIds.filter((id) => !this.docSections.has(id));
      if (!prose.length) return;
      if (checkpointScope === undefined) await review(prose);
      else await review(prose, checkpointScope);
    };
  }
  set reviewSections(review: Review | undefined) { this.review = review; }
}

export function withDocsStyle(article: SectionWriter, docs: SectionWriter): SectionWriter {
  return new StyledSectionWriter(article, docs);
}
