import "server-only";

import { z } from "zod";
import { type ChatMessage, chatJson, type TokenFactorySettings } from "@/lib/ai/chat";
import type { SectionReviseInput, SectionRevision } from "../types";

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

// PROMPT: the writer's rules
const SYSTEM_PROMPT = [
  "You maintain one section of an internal wiki page, written in the neutral, encyclopedic style of Wikipedia.",
  "The section is a list of lines. Each line states one or more claims and cites them by ref (C1, C2, ...).",
  "Only lines marked rewrite:true need work: a claim they cite changed, or the section no longer shows it.",
  "For each such line, either rewrite it from the current claims (revise) or remove it (retire) when nothing it said still holds.",
  "Then write one new line (add) for each claim listed in uncovered, unless a revised line already states it.",
  "Use ONLY the claims given. Never add facts, dates, names, numbers or opinions that are not in them.",
  "Each line is one or two sentences and must list in claims the refs it states. Never touch lines with rewrite:false.",
  'Answer with JSON only: {"revise":[{"line":"L1","text":"...","claims":["C1"]}],"retire":["L2"],"add":[{"text":"...","claims":["C3"]}]}.',
].join(" ");

// REAL WRITER: one chat completion per section that needs work
export class TokenFactorySectionWriter {
  readonly name = "token-factory";

  constructor(private readonly settings: TokenFactorySettings) {}

  // Sends the section with short refs, then maps the answer's refs back to ids
  async reviseSection(input: SectionReviseInput): Promise<SectionRevision> {
    const refs = buildRefs(input);
    const { value, model } = await chatJson(this.settings, {
      name: "section_lines",
      schema: sectionAnswerSchema,
      jsonSchema: z.toJSONSchema(sectionAnswerSchema),
      messages: buildMessages(input, refs),
    });
    return { ...answerToRevision(value, refs), modelVersion: model };
  }
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
function buildMessages(input: SectionReviseInput, refs: Refs): ChatMessage[] {
  const toRefs = (ids: string[]) => ids.flatMap((id) => refs.unitRef.get(id) ?? []);
  const claims = input.units.map((unit) => ({ ref: refs.unitRef.get(unit.unitId), kind: unit.kind, status: unit.epistemicStatus, claim: unit.content }));
  const lines = input.lines.map((line) => ({ ref: refs.lineRef.get(line.lineId), text: line.content, claims: toRefs(line.unitIds), rewrite: line.needsRewrite }));
  const request = { page: input.pageTitle, section: input.sectionTitle, claims, lines, uncovered: toRefs(input.uncoveredUnitIds) };
  return [
    { role: "system", content: SYSTEM_PROMPT },
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
      return lineId ? [{ lineId, text: line.text, unitIds: toIds(line.claims) }] : [];
    }),
    retire: answer.retire.flatMap((ref) => lineIdOf(ref) ?? []),
    add: answer.add.map((line) => ({ text: line.text, unitIds: toIds(line.claims) })),
  };
}
