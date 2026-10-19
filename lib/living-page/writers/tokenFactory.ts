import { TOPIC_FIRST_PROSE, SOURCE_ATTRIBUTION_POLICY } from "../articleStyle";
import { checkEditorialDraft, selectEditorialClaims } from "./editorialSelection";
import { revisionToActions } from "../plan";
import "server-only";

import { z } from "zod";
import { addUsage, type ChatMessage, chatJson, type StreamedSoFar, type TokenFactorySettings, type TokenUsage } from "@/lib/ai/chat";
import type { SectionReviseInput, SectionRevision } from "../types";
import { partialSectionAnswer, type SectionProgress } from "../buildProgress";
import { skillInstructions, skillTrace } from "@/lib/ai/skills/prompt";
import { withoutEditorialDashes } from "../punctuation";
import { unsupportedProseNumbers, withSupportedCharts } from "../blocks";
import type { StageSkills } from "@/lib/ai/skills/types";
import { checkLines, failedLines, type CheckedClaim, type LineToCheck, type LineVerdict } from "./lineCheck";
import { TEXT_PATCH_INSTRUCTIONS, TextPatchError } from "../textPatch";
import { materializePatchAnswer, patchAnswerSchema } from "./patchAnswer";
import { IncompleteSectionEvidence } from "../draftEvidence";

// =====================================================================
// TOKEN FACTORY WRITER: Nemotron rewrites only the lines whose claims
// changed and writes lines for claims no line states yet, in the
// neutral style of an encyclopedia. It sees short refs (L1, C1) instead
// of uuids, so it cannot invent ids; refs it makes up are dropped, and
// plan.ts drops anything that touches an unflagged line or cites nothing.
// Every line it writes is then fact-checked against its cited claims
// (./lineCheck.ts); failures go back once for a fix, then are dropped.
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
  "When a source already numbers steps and cites branch destinations, do not introduce conflicting local step numbers. Use chronological prose or unnumbered phase bullets, explicitly attributing retained step numbers to the source. Present alternative branches as alternatives, never as successive mandatory actions.",
  "(3) Table, for comparing several items on the same attributes: '| Header | Header |' then '|---|---|' then one '| cell | cell |' row per item; at least 2 columns and 2 rows.",
  "(4) Chart, only when claims state at least 3 numbers measured in the same unit across categories or over time: a row '```chart bar Title' (bar, hbar for long labels, line for change over time, pie for parts of one whole), then one 'Label: number' row per value, then a row '```'. Every number must appear in a cited claim; a chart with any other number is removed.",
  "(5) Callout, for one critical rule or warning the reader must not miss: '> text'. Use it rarely.",
  "A claim with a structure is a composite, and claims whose stepOf names it belong with it. Preserve every member and the relative order of actual procedural steps. For a process involving several actors, interleave their actions in end-to-end chronological order, including intervening actions from other claims, rather than finishing one actor's entire lane before starting another. A member describing tools, diagram lanes or other context is a contextual note, never an invented numbered action. Cite the composite and every member across the resulting steps and notes. Write a set as one lead-in list; its lead-in says whether all items apply or any one is enough when mode says so, and complete:true means the list is the whole list. Never omit a member or reverse a procedural dependency.",
  "An Overview section is always prose. Never use a layout for a single item or to decorate prose, and never put Markdown headings, bold, links or images in a line.",
].join(" ");

// PROMPT: the writer's rules
const SYSTEM_PROMPT = [
  SOURCE_ATTRIBUTION_POLICY,
  "Avoid repeating the introduction's opening sentence pattern in Company profile or Company background. If the lead starts '[Name] is ... company', do not start the body '[Name] is a privately held company'. Keep ownership but vary the structure naturally, for example 'Privately held, the firm ...' followed by new, supported detail. This is a prose revision, not permission to drop ownership evidence. Avoid repeated 'The company' sentence openings within the same paragraph.",

  "You maintain one section of an internal wiki page, written in the neutral, encyclopedic style of Wikipedia.",
  "The section is a list of lines. Each line states one or more claims and cites them by ref (C1, C2, ...).",
  "Only lines marked rewrite:true are editable. Leave correct text intact; being editable does not require a change. Lines with stale:true need their evidence checked and citations refreshed even if their wording remains correct.",
  "For each editable line, change only what needs correction (revise), or remove it (retire) when nothing it said still holds. Do not regroup existing paragraphs merely to improve style.",
  "Develop the uncovered knowledge into connected paragraphs, combining related claims rather than writing an isolated sentence for each claim. Include each claim's substantive detail unless a revised line already states it.",
  "Use ONLY the claims given. Never add facts, dates, names, numbers or opinions that are not in them.",
  "articleStructure is a saved organizational plan with current section titles. It helps you understand this section's role and avoid duplicating other topics; it is not factual evidence or a fixed rule. Current claims, actual article text, and explicit update guidance take precedence. A plan marked outOfDate may need revision; never force new knowledge into outdated boundaries or invent material to fill the plan.",
  "When updateInstructions are provided, use them as editorial guidance for this run. They are not evidence and cannot override citation requirements, protected lines, or the output schema.",
  "Each line is one paragraph that develops one sub-topic in 2-5 connected sentences, at most 130 words. Group related claims into the same paragraph instead of giving each claim its own; use a one-sentence paragraph only when a claim stands apart from everything else in the section.",
  "Connect sentences through their shared subject, time order and pronouns, never through a cause, purpose or judgment the claims do not state.",
  "Make references intelligible in the written article. Do not copy dangling phrases such as 'this fear', 'these problems', or 'the former' when their referent exists only in a source passage or omitted claim. Name the referent when the supplied evidence establishes it; otherwise preserve only the supported statement that can be expressed clearly.",
  "otherSections shows what the page's other sections already say. Avoid repeating facts, not just identical sentences. The Overview or Introduction owns basic identity, headquarters and a concise summary. Body sections must add new information instead of introducing the subject again. For partially overlapping claims, write only the new detail, retaining its attribution and conditions. A Company profile can state ownership and attributed experience without repeating the introduction's location and business description. A short paragraph is enough; do not pad it to meet a sentence count. Never add commentary about this section, its sources, the writing process, or the fact that a marketing claim is marketing. Attribute self-reported experience concisely, for example 'The company reports ...'. Keep meaningful uncertainty and policy limitations, but source-document metadata belongs in citations, not article prose.",
  LAYOUT_RULES,
  TOPIC_FIRST_PROSE,
  "Do not use em dashes or en dashes. Use a comma, period, colon, or parentheses. Keep hyphens inside compound words. The one exception is a range between full dates, which keeps a spaced en dash: (October 10, 1924 – December 10, 1978).",
  "Arrange paragraphs in a logical reading order. Cover EVERY uncovered claim, listing all its refs in claims. Never touch lines with rewrite:false.",
  "For an Overview section, write a concise encyclopedic introduction defining the subject and scope, rather than a list of policies or facts.",
  "For topic sections, explain the topic coherently. Avoid boilerplate, unsupported context, invented links, or citation numbers; the interface adds real links and references.",
  "Never put internal claim labels such as (C1, C2) or [C3] in text. Put them only in the structured claims array; the interface renders their citations.",
].join(" ");

// REAL WRITER: one chat completion per section that needs work
export class TokenFactorySectionWriter {
  readonly name = "token-factory";
  get promptVersion() { return skillTrace("article-writing-v10-evidence-after-editorial",["write_articles"],this.settings.skills); }

  constructor(private readonly settings: TokenFactorySettings) {}

  // Sends the section with short refs, then maps the answer's refs back to ids
  // and streams the paragraphs to `progress` as they are written.
  // The answer is fact-checked; failed lines get one fix, and lines still failing are dropped.
  async reviseSection(input: SectionReviseInput, progress?: SectionProgress): Promise<SectionRevision> {
    const selection = await selectEditorialClaims(this.settings, input);
    const omitted = new Set(selection.omittedUnitIds);
    input = { ...input, units: input.units.filter((unit) => !omitted.has(unit.unitId)), uncoveredUnitIds: input.uncoveredUnitIds.filter((id) => !omitted.has(id)) };
    const refs = buildRefs(input);
    const messages = buildMessages(input, refs, this.settings.skills);
    if (omitted.size) messages.push({ role: "system", content: "Editorial selection removed source-document metadata and facts fully stated elsewhere from the claims. Retire any rewriteable line that now has no claims. Remove those omitted facts from mixed lines, preserving all remaining evidence. Do not invent replacement filler or attach unrelated citations." });
    const claims = refClaims(input, refs);
    const patchMode = input.lines.length > 0;
    const schema = patchMode ? patchAnswerSchema : sectionAnswerSchema;
    const write = async (prompt: ChatMessage[]) => {
      const request = (messages: ChatMessage[]) => chatJson(this.settings, {
      outputStyle: "wiki_article",
      name: "section_lines",
      subject: `${input.pageTitle} › ${input.sectionTitle}`,
      schema,
      jsonSchema: z.toJSONSchema(schema),
      messages,
      retryInvalidOutput: true,
      maxTokens: 8000,
      ...(progress ? { onStream: ({ content, reasoning }: StreamedSoFar) => {
        // Saved text remains visible until complete patches pass all checks.
        if (patchMode) { if (reasoning.trim()) progress.thinking(tail(reasoning, THINKING_TAIL)); }
        else streamToProgress(content, reasoning, refs, progress);
      } } : {}),
      });
      const materialize = (value: unknown): SectionAnswer => patchMode
        ? materializePatchAnswer(patchAnswerSchema.parse(value), input)
        : sectionAnswerSchema.parse(value);
      const first = await request(prompt);
      try { return { ...first, value: materialize(first.value) }; }
      catch (error) {
        if (!(error instanceof TextPatchError)) throw error;
        const fixed = await request([...prompt, { role: "user", content: `No patches were applied: ${error.message} Correct the complete patch plan against the original paragraphs. Previous plan: ${JSON.stringify(first.value)}` }]);
        return { ...fixed, ...addUsage(first, fixed), value: materialize(fixed.value) };
      }
    };
    const clean = (answer: SectionAnswer) => {
      const cleaned = withoutInlineClaimAnnotations(answer, claims);
      return patchMode ? { ...cleaned, revise: answer.revise } : cleaned;
    };
    const first = await write(messages);
    let usage: TokenUsage = addUsage(selection, first);
    let answer = clean(first.value);
    progress?.step("Checking each paragraph against its claims…");
    const check = async (draft: SectionAnswer) => {
      const checked = await checkLines(this.settings, { page: input.pageTitle, section: input.sectionTitle, lines: linesToCheck(draft, claims), sectionClaims: sectionClaims(claims) });
      if (patchMode && linesToCheck(draft, claims).some((line) => !checked.verdicts.some((verdict) => verdict.line === line.ref))) throw new Error("An edit received no evidence verdict; no patches were saved.");
      const editorial = input.pageContext?.length || omitted.size
        ? await checkEditorialDraft(this.settings, input, linesToCheck(draft, claims))
        : { verdicts: [], tokensIn: 0, tokensOut: 0 };
      // Match the final commit's numeric check before the repair attempt, so a
      // missed citation is repaired instead of silently losing the paragraph.
      const verdicts = withNumericSupportVerdicts(withCitations(draft, checked.verdicts), claims, [input.pageTitle, input.sectionTitle], checked.verdicts);
      return { ...addUsage(checked, editorial), factualVerdicts: verdicts, editorialProblems: editorial.verdicts, verdicts: [...verdicts, ...editorial.verdicts] };
    };
    let checked = await check(answer);
    answer = withCitations(answer, checked.verdicts);
    usage = addUsage(usage, checked);
    const failed = failedLines(checked.verdicts);
    const missing = missingDraftClaims(input, answer);
    if (failed.length || missing.length) {
      progress?.step("Repairing evidence coverage, repetition and wording…");
      const fixed = await write([...messages, { role: "user", content: `${repairRequest(answer, failed)}${missing.length ? ` Your draft also omitted required claims ${missing.join(", ")}. Cover each with a supported citation. For a partially overlapping claim, state its new detail only; do not repeat facts already in otherSections. These claims were retained by editorial selection and cannot be dropped. You may revise otherwise supported lines to incorporate the missing details.` : ""}` }]);
      usage = addUsage(usage, fixed);
      answer = clean(fixed.value);
      checked = await check(answer);
      answer = withCitations(answer, checked.verdicts);
      usage = addUsage(usage, checked);
      // A fact repair can reintroduce a source's redundant wording. Give the
      // editor one focused pass over the current draft, without the old prose.
      for (let editorialAttempt = 0; editorialAttempt < 2 && (checked.editorialProblems.length || missingDraftClaims(input, answer).length || (editorialAttempt > 0 && failedLines(checked.factualVerdicts).length)); editorialAttempt++) {
        const edited = await write([
          ...messages,
          { role: "system", content: "Fix each listed issue by changing only the affected passages. Correct factualIssues first, preserving every factual qualifier and condition; a style change must not weaken evidence support. Keep new detail and concise attribution. A citation does NOT require repeating the entire source claim. Preserve all unaffected text. Return the complete corrected answer in the supplied schema, relative to the original paragraphs." },
          { role: "user", content: JSON.stringify({ page: input.pageTitle, section: input.sectionTitle, claims, otherSections: input.pageContext, draft: answer, issues: checked.editorialProblems, factualIssues: failedLines(checked.factualVerdicts), requiredUncoveredClaims: missingDraftClaims(input, answer), coverageInstruction: "Every requiredUncoveredClaims ref must be represented by its NEW factual detail and cited. Retain distinct project scope and service location. Remove subclauses already stated elsewhere, even when they occur inside a retained compound claim. Covering a claim does not mean restating all its words or propositions." }) },
        ]);
        usage = addUsage(usage, edited);
        answer = clean(edited.value);
        checked = await check(answer);
        answer = withCitations(answer, checked.verdicts);
        usage = addUsage(usage, checked);
      }
      const stillFailing = failedLines(checked.factualVerdicts);
      if (patchMode && stillFailing.length) throw new Error("The proposed text edits still fail evidence checks; no patches were saved.");
      // Repetition is a repair request, not permission to lose supported detail.
      // After bounded repairs, the whole-page editor can polish residual overlap.
      if (checked.editorialProblems.length) console.warn("Section kept supported detail for page editorial review", { page: input.pageTitle, section: input.sectionTitle, issues: checked.editorialProblems.map(problem => problem.problem) });
      const lineOf = new Map(linesToCheck(answer, claims).map((line) => [line.ref, line]));
      for (const verdict of stillFailing) {
        const line = lineOf.get(verdict.line);
        console.warn("Writer line dropped by the fact-check", { page: input.pageTitle, section: input.sectionTitle, line: verdict.line, text: line?.text.slice(0, 200), claims: line?.claims.map((claim) => claim.ref), problem: verdict.problem });
      }
      answer = withoutLines(answer, new Set(stillFailing.map((verdict) => verdict.line)));
    }
    if (missingDraftClaims(input, answer).length) throw new IncompleteSectionEvidence();
    return { ...answerToRevision(answer, refs), textPatches: patchMode, omittedUnitIds: selection.omittedUnitIds, modelVersion: first.model, ...usage };
  }
}

// Internal C refs belong in the structured citations, never in rendered prose.
// Remove only known refs cited by that line and absent from the actual source text:
// real engineering labels such as C1/C2 and unsupported numbers stay protected.
export function withoutInlineClaimAnnotations(answer: SectionAnswer, claims: { ref: string; claim: string }[]): SectionAnswer {
  const known = new Set(claims.map((claim) => claim.ref));
  const sourceLabels = new Set(claims.flatMap((claim) => claim.claim.match(/\bC[1-9]\d*\b/g) ?? []));
  const clean = <T extends { text: string; claims: string[] }>(line: T): T => ({ ...line,
    text: line.text.replace(/[ \t]*\((C[1-9]\d*(?:\s*[,;]\s*C[1-9]\d*)*)\)|[ \t]*\[(C[1-9]\d*(?:\s*[,;]\s*C[1-9]\d*)*)\]/g, (annotation, round: string | undefined, square: string | undefined) => {
      const labels = (round ?? square ?? "").split(/\s*[,;]\s*/);
      return labels.every((ref) => known.has(ref) && line.claims.includes(ref) && !sourceLabels.has(ref)) ? "" : annotation;
    }),
  });
  return { ...answer, revise: answer.revise.map(clean), add: answer.add.map(clean) };
}

export function withNumericSupportVerdicts(answer: SectionAnswer, claims: { ref: string; claim: string }[], titles: string[], verdicts: LineVerdict[]): LineVerdict[] {
  const byLine = new Map(verdicts.map((verdict) => [verdict.line, verdict]));
  for (const line of linesToCheck(answer, claims)) {
    const cited = line.claims.map((claim) => claim.claim);
    const numbers = unsupportedProseNumbers(withSupportedCharts(line.text, cited), [...cited, ...titles]);
    if (numbers.length) byLine.set(line.ref, { ...byLine.get(line.ref), line: line.ref, supported: false,
      problem: `The numbers ${numbers.join(", ")} are not supported by this paragraph's cited claims. Cite the supplied claim that actually states them, or remove the unsupported numbers. Never cite an unrelated claim merely because it shares a number.` });
  }
  return [...byLine.values()];
}

// =====================================================================
// FACT-CHECK: the answer's lines in ref space (L1 revised, A1 added),
// each beside only the claims it cites
// =====================================================================

// The checker sees each claim exactly as the writer saw it
function linesToCheck(answer: SectionAnswer, claims: CheckedClaim[]): LineToCheck[] {
  const claimOf = new Map(claims.map((claim) => [claim.ref, claim]));
  const cited = (claims: string[]) => [...new Set(claims.map((ref) => ref.trim()))].flatMap((ref) => {
    const claim = claimOf.get(ref);
    return claim ? [{ ref, claim: claim.claim, status: claim.status, context: claim.context ?? null }] : [];
  });
  const lines = [
    ...answer.revise.map((line) => ({ ref: line.line.trim(), text: line.text, claims: cited(line.claims) })),
    ...answer.add.map((line, index) => ({ ref: addRef(index), text: line.text, claims: cited(line.claims) })),
  ];
  // A line with no text or no known claim is dropped later anyway; nothing to check
  return lines.filter((line) => line.text.trim() && line.claims.length > 0);
}

const addRef = (index: number) => `A${index + 1}`;

// Every claim of the section, for mending a line that states a claim it forgot to cite
function sectionClaims(claims: ReturnType<typeof refClaims>) {
  return claims.map((claim) => ({ ref: claim.ref, claim: claim.claim, status: claim.status, context: claim.context ?? null }));
}

// The answer with the citations the fact-check found missing added to their lines
export function withCitations(answer: SectionAnswer, verdicts: LineVerdict[]): SectionAnswer {
  const extra = new Map(verdicts.flatMap((verdict) => (verdict.addCitations?.length ? [[verdict.line, verdict.addCitations] as const] : [])));
  if (extra.size === 0) return answer;
  const cite = (claims: string[], ref: string) => [...claims, ...(extra.get(ref) ?? []).filter((add) => !claims.some((claim) => claim.trim() === add))];
  return {
    revise: answer.revise.map((line) => ({ ...line, claims: cite(line.claims, line.line.trim()) })),
    retire: answer.retire,
    add: answer.add.map((line, index) => ({ ...line, claims: cite(line.claims, addRef(index)) })),
  };
}

// Asks the writer for its whole answer again, with the failed lines fixed
function repairRequest(answer: SectionAnswer, failed: LineVerdict[]): string {
  return [
    `Your previous answer was ${JSON.stringify(answer)}.`,
    `A fact-check found lines that state things their cited claims do not support (A1, A2, ... are your add entries in order): ${JSON.stringify(failed.map(({ line, problem }) => ({ line, problem })))}.`,
    "Return the complete corrected answer. Rewrite each listed line using only what its cited claims state, or cite the claim that does state it. Keep every other line exactly as it was.",
  ].join(" ");
}

// The answer without the lines named by ref
export function withoutLines(answer: SectionAnswer, drop: ReadonlySet<string>): SectionAnswer {
  if (drop.size === 0) return answer;
  return {
    revise: answer.revise.filter((line) => !drop.has(line.line.trim())),
    retire: answer.retire,
    add: answer.add.filter((_, index) => !drop.has(addRef(index))),
  };
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
export function buildRefs(input: SectionReviseInput): Refs {
  const unitPairs = input.units.map((unit, index) => [unit.unitId, `C${index + 1}`] as const);
  const linePairs = input.lines.map((line, index) => [line.lineId, `L${index + 1}`] as const);
  return {
    unitRef: new Map(unitPairs),
    unitId: new Map(unitPairs.map(([id, ref]) => [ref, id])),
    lineRef: new Map(linePairs),
    lineId: new Map(linePairs.map(([id, ref]) => [ref, id])),
  };
}

// Check effective actions, not raw model citations: invalid/protected edits do
// not count as coverage. Used for one repair before Update's final coverage guard.
export function missingDraftClaims(input: SectionReviseInput, answer: SectionAnswer): string[] {
  const refs = buildRefs(input);
  const revision = { ...answerToRevision(answer, refs), modelVersion: "preview" };
  const actions = revisionToActions(revision, { ...input, title: input.sectionTitle, sectionId: "preview" });
  const changed = new Set(actions.filter((action) => action.type === "revise_line" || action.type === "retire_line").map((action) => action.targetId));
  const covered = new Set(input.lines.filter((line) => !changed.has(line.lineId)).flatMap((line) => line.unitIds));
  const byRevision = new Map(input.units.map((unit) => [unit.revisionId, unit.unitId]));
  for (const action of actions) if (action.type === "write_line" || action.type === "revise_line") {
    for (const id of action.input.unitRevisionIds) {
      const unitId = byRevision.get(id);
      if (unitId) covered.add(unitId);
    }
  }
  return input.units.filter((unit) => !covered.has(unit.unitId)).map((unit) => refs.unitRef.get(unit.unitId)!);
}

// The section's claims as the writer sees them (C1, C2, ...); the fact-check reads the same ones
function refClaims(input: SectionReviseInput, refs: Refs) {
  return input.units.map((unit) => ({
    ref: refs.unitRef.get(unit.unitId)!, kind: unit.kind, status: unit.epistemicStatus, claim: unit.content, context: unit.context,
    ...(unit.structure ? { structure: unit.structure } : {}),
    ...(unit.memberOf && refs.unitRef.has(unit.memberOf) ? { stepOf: refs.unitRef.get(unit.memberOf), ...(unit.position ? { step: unit.position } : {}) } : {}),
  }));
}

// Existing sections use exact edits; new sections still use full new paragraphs.
export const PATCH_RULE = `${TEXT_PATCH_INSTRUCTIONS} Each revise entry is {line,patches,claims}; claims must support the ENTIRE resulting paragraph, including retained sentences. Each retire entry is {line,old_text}, quoting the complete original text. Add entries are {text,claims}. Retire only when the evidence or an explicit removal request warrants it. Answer with JSON only: {"revise":[],"retire":[],"add":[]}.`;

// Builds the system + user messages: the page, the section, its claims and its lines as JSON
export function buildMessages(input: SectionReviseInput, refs: Refs, skills?: StageSkills): ChatMessage[] {
  const toRefs = (ids: string[]) => ids.flatMap((id) => refs.unitRef.get(id) ?? []);
  const claims = refClaims(input, refs);
  const lines = input.lines.map((line) => ({ ref: refs.lineRef.get(line.lineId), text: line.content, claims: toRefs(line.unitIds), rewrite: line.needsRewrite, stale: line.needsCitationRefresh ?? line.needsRewrite }));
  const request = {
    page: input.pageTitle, section: input.sectionTitle, claims, lines, uncovered: toRefs(input.uncoveredUnitIds),
    ...(input.pageContext?.length ? { otherSections: boundedContext(input.pageContext) } : {}),
    ...(input.updateNote ? { updateInstructions: input.updateNote } : {}),
    ...(input.articleStructure ? { articleStructure: input.articleStructure } : {}),
  };
  return [
    { role: "system", content: `${SYSTEM_PROMPT}

Preserve each claim's explicit context and conditions. General reference knowledge does not establish an organization's policy or a person's preferences. Unspecified applicability means unknown. Mentioned entities do not own the claim.
${skillInstructions(["write_articles"],skills)}` },
    { role: "system", content: input.lines.length ? PATCH_RULE : 'Answer with JSON only: {"revise":[],"retire":[],"add":[{"text":"...","claims":["C1"]}]}.' },
    { role: "user", content: JSON.stringify(request) },
  ];
}

// The other sections' text, cut to a budget so a long page never crowds out the section's own claims
const CONTEXT_CHARS = 8000;
function boundedContext(sections: { section: string; text: string }[]) {
  let left = CONTEXT_CHARS;
  return sections.flatMap(({ section, text }) => {
    if (left <= 0) return [];
    const kept = text.length > left ? `${text.slice(0, left)}…` : text;
    left -= kept.length;
    return [{ section, text: kept }];
  });
}

// Maps refs back to ids; unknown refs are dropped (plan.ts drops lines left citing nothing)
export function answerToRevision(answer: SectionAnswer, refs: Refs): Omit<SectionRevision, "modelVersion"> {
  const toIds = (claims: string[]) => claims.flatMap((ref) => refs.unitId.get(ref.trim()) ?? []);
  const lineIdOf = (ref: string) => refs.lineId.get(ref.trim());
  return {
    revise: answer.revise.flatMap((line) => {
      const lineId = lineIdOf(line.line);
      return lineId ? [{ lineId, text: line.text, unitIds: toIds(line.claims) }] : [];
    }),
    retire: answer.retire.flatMap((ref) => lineIdOf(ref) ?? []),
    add: answer.add.map((line) => ({ text: withoutEditorialDashes(line.text), unitIds: toIds(line.claims) })),
  };
}
