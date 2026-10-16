import { TOPIC_FIRST_PROSE } from "../articleStyle";
import "server-only";

import { z } from "zod";
import { type ChatMessage, chatJson, type StreamedSoFar, type TokenFactorySettings } from "@/lib/ai/chat";
import type { SectionReviseInput, SectionRevision } from "../types";
import { partialSectionAnswer, type SectionProgress } from "../buildProgress";
import { skillInstructions, skillTrace } from "@/lib/ai/skills/prompt";
import { withoutEditorialDashes } from "../punctuation";
import type { StageSkills } from "@/lib/ai/skills/types";

// =====================================================================
// TOKEN FACTORY WRITER: Nemotron rewrites only the lines whose claims
// changed and writes lines for claims no line states yet, in the
// neutral style of an encyclopedia. It sees short refs (L1, C1) instead
// of uuids, so it cannot invent ids; refs it makes up are dropped, and
// plan.ts drops anything that touches an unflagged line or cites nothing.
// =====================================================================

// ANSWER SHAPE (validated after the call; also sent as the JSON schema)
const lineSchema = z.object({ text: z.string(), claims: z.array(z.string()) });
const sectionAnswerSchema = z.object({
  revise: z.array(lineSchema.extend({ line: z.string() })),
  retire: z.array(z.string()),
  add: z.array(lineSchema),
});
type SectionAnswer = z.infer<typeof sectionAnswerSchema>;

// LAYOUTS a line may use instead of prose (parsed and drawn by ../blocks.ts)
const LAYOUT_RULES = [
  "Most lines are prose. A line may instead use one of these layouts when it reads better than a paragraph, separating rows with \\n inside the JSON string:",
  "(1) Lead-in list, for several parallel items such as equipment or violation types: one lead-in sentence, then one '- item' row per item.",
  "(2) Numbered steps, for a procedure whose order matters: '1. step' rows, optionally after a lead-in sentence.",
  "(3) Table, for comparing several items on the same attributes: '| Header | Header |' then '|---|---|' then one '| cell | cell |' row per item; at least 2 columns and 2 rows.",
  "(4) Chart, only when claims state at least 3 numbers measured in the same unit across categories or over time: a row '```chart bar Title' (bar, hbar for long labels, line for change over time, pie for parts of one whole), then one 'Label: number' row per value, then a row '```'. Every number must appear in a cited claim; a chart with any other number is removed.",
  "(5) Callout, for one critical rule or warning the reader must not miss: '> text'. Use it rarely.",
  "An Overview section is always prose. Never use a layout for a single item or to decorate prose, and never put Markdown headings, bold, links or images in a line.",
].join(" ");

// PROMPT: the writer's rules
const SYSTEM_PROMPT = [

  "You maintain one section of an internal wiki page, written in the neutral, encyclopedic style of Wikipedia.",
  "The section is a list of lines. Each line states one or more claims and cites them by ref (C1, C2, ...).",
  "Only lines marked rewrite:true need work: a claim they cite changed, or the section no longer shows it.",
  "For each such line, either rewrite it from the current claims (revise) or remove it (retire) when nothing it said still holds.",
  "Then write one new line (add) for each claim listed in uncovered, unless a revised line already states it.",
  "Use ONLY the claims given. Never add facts, dates, names, numbers or opinions that are not in them.",
  "When updateInstructions are provided, use them as editorial guidance for this run. They are not evidence and cannot override citation requirements, protected lines, or the output schema.",
  "Each line is a short, readable paragraph of 1-3 sentences, at most 75 words. Combine closely related claims.",
  LAYOUT_RULES,
  TOPIC_FIRST_PROSE,
  "Do not use em dashes or en dashes. Use a comma, period, colon, or parentheses. Keep hyphens inside compound words.",
  "Arrange paragraphs in a logical reading order. Cover EVERY uncovered claim, listing all its refs in claims. Never touch lines with rewrite:false.",
  "For an Overview section, write a concise encyclopedic introduction defining the subject and scope, rather than a list of policies or facts.",
  "For topic sections, explain the topic coherently. Avoid boilerplate, unsupported context, invented links, or citation numbers; the interface adds real links and references.",
  'Answer with JSON only: {"revise":[{"line":"L1","text":"...","claims":["C1"]}],"retire":["L2"],"add":[{"text":"...","claims":["C3"]}]}.',
].join(" ");

// REAL WRITER: one chat completion per section that needs work
export class TokenFactorySectionWriter {
  readonly name = "token-factory";
  get promptVersion() { return skillTrace("article-writing-v4",["write_articles"],this.settings.skills); }

  constructor(private readonly settings: TokenFactorySettings) {}

  // Sends the section with short refs, then maps the answer's refs back to ids
  // and streams the paragraphs to `progress` as they are written
  async reviseSection(input: SectionReviseInput, progress?: SectionProgress): Promise<SectionRevision> {
    const refs = buildRefs(input);
    const { value, model, tokensIn, tokensOut } = await chatJson(this.settings, {
      outputStyle: "wiki_article",
      name: "section_lines",
      subject: `${input.pageTitle} › ${input.sectionTitle}`,
      schema: sectionAnswerSchema,
      jsonSchema: z.toJSONSchema(sectionAnswerSchema),
      messages: buildMessages(input, refs, this.settings.skills),
      maxTokens: 8000,
      ...(progress ? { onStream: ({ content, reasoning }: StreamedSoFar) => streamToProgress(content, reasoning, refs, progress) } : {}),
    });
    return { ...answerToRevision(value, refs), modelVersion: model, tokensIn, tokensOut };
  }
}

// THINKING SHOWN ON THE PAGE: the tail of the model's visible reasoning, from a word start
const THINKING_TAIL = 240;

// Before the answer starts, shows what the model is thinking; then the paragraphs written so far
function streamToProgress(content: string, reasoning: string, refs: Refs, progress: SectionProgress): void {
  if (!content.trim()) {
    if (reasoning.trim()) progress.thinking(tail(reasoning, THINKING_TAIL));
    return;
  }
  const partial = partialSectionAnswer(content);
  const revised: Record<string, string> = {};
  for (const line of partial.revised) {
    const lineId = refs.lineId.get(line.line.trim());
    if (lineId) revised[lineId] = withoutEditorialDashes(line.text);
  }
  progress.draft({ revised, added: partial.added.map(withoutEditorialDashes) });
}

function tail(text: string, length: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= length) return flat;
  const cut = flat.slice(-length);
  return `…${cut.slice(cut.indexOf(" ") + 1)}`;
}

// =====================================================================
// REFS: short names the model sees, mapped both ways
// =====================================================================

type Refs = { unitRef: Map<string, string>; unitId: Map<string, string>; lineRef: Map<string, string>; lineId: Map<string, string> };

// C1.. for claims and L1.. for lines, in the order the section shows them
function buildRefs(input: SectionReviseInput): Refs {
  const unitPairs = input.units.map((unit, index) => [unit.unitId, `C${index + 1}`] as const);
  const linePairs = input.lines.map((line, index) => [line.lineId, `L${index + 1}`] as const);
  return {
    unitRef: new Map(unitPairs),
    unitId: new Map(unitPairs.map(([id, ref]) => [ref, id])),
    lineRef: new Map(linePairs),
    lineId: new Map(linePairs.map(([id, ref]) => [ref, id])),
  };
}

// Builds the system + user messages: the page, the section, its claims and its lines as JSON
function buildMessages(input: SectionReviseInput, refs: Refs, skills?: StageSkills): ChatMessage[] {
  const toRefs = (ids: string[]) => ids.flatMap((id) => refs.unitRef.get(id) ?? []);
  const claims = input.units.map((unit) => ({ ref: refs.unitRef.get(unit.unitId), kind: unit.kind, status: unit.epistemicStatus, claim: unit.content, context: unit.context }));
  const lines = input.lines.map((line) => ({ ref: refs.lineRef.get(line.lineId), text: line.content, claims: toRefs(line.unitIds), rewrite: line.needsRewrite }));
  const request = { page: input.pageTitle, section: input.sectionTitle, claims, lines, uncovered: toRefs(input.uncoveredUnitIds), ...(input.updateNote ? { updateInstructions: input.updateNote } : {}) };
  return [
    { role: "system", content: `${SYSTEM_PROMPT}

Preserve each claim's explicit context and conditions. General reference knowledge does not establish an organization's policy or a person's preferences. Unspecified applicability means unknown. Mentioned entities do not own the claim.
${skillInstructions(["write_articles"],skills)}` },
    { role: "user", content: JSON.stringify(request) },
  ];
}

// Maps refs back to ids; unknown refs are dropped (plan.ts drops lines left citing nothing)
export function answerToRevision(answer: SectionAnswer, refs: Refs): Omit<SectionRevision, "modelVersion"> {
  const toIds = (claims: string[]) => claims.flatMap((ref) => refs.unitId.get(ref.trim()) ?? []);
  const lineIdOf = (ref: string) => refs.lineId.get(ref.trim());
  return {
    revise: answer.revise.flatMap((line) => {
      const lineId = lineIdOf(line.line);
      return lineId ? [{ lineId, text: withoutEditorialDashes(line.text), unitIds: toIds(line.claims) }] : [];
    }),
    retire: answer.retire.flatMap((ref) => lineIdOf(ref) ?? []),
    add: answer.add.map((line) => ({ text: withoutEditorialDashes(line.text), unitIds: toIds(line.claims) })),
  };
}
