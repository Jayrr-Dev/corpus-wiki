import "server-only";

import { z } from "zod";
import { type ChatMessage, chatJson, type TokenFactorySettings } from "@/lib/ai/chat";
import type { SectionWriteInput, WrittenSection, WrittenSentence } from "../types";

// =====================================================================
// TOKEN FACTORY WRITER: Nemotron writes a short encyclopedia paragraph
// from the section's claims only. Every sentence cites the unit ids it
// says; ids that were not in the input are dropped, and a sentence left
// citing nothing is dropped too, so the page never shows uncited text.
// =====================================================================

// ANSWER SHAPE (validated after the call; also sent as the JSON schema)
const sectionAnswerSchema = z.object({
  sentences: z.array(z.object({ text: z.string(), unitIds: z.array(z.string()) })),
});

// PROMPT: the writer's rules
const SYSTEM_PROMPT = [
  "You write one section of an internal wiki page, in the neutral, encyclopedic style of Wikipedia.",
  "Use ONLY the claims you are given. Never add facts, dates, names, numbers or opinions that are not in them.",
  "Write a short paragraph (one to five sentences). You may merge closely related claims into one sentence.",
  "Every sentence must list in unitIds the ids of the claims it states. Use only ids from the input.",
  'Answer with JSON only: {"sentences":[{"text":"...","unitIds":["..."]}]}.',
].join(" ");

// REAL WRITER: one chat completion per section
export class TokenFactorySectionWriter {
  readonly name = "token-factory";

  constructor(private readonly settings: TokenFactorySettings) {}

  // Asks the model for cited sentences and keeps only citations of the given units
  async writeSection(input: SectionWriteInput): Promise<WrittenSection> {
    const { value, model } = await chatJson(this.settings, {
      name: "section_sentences",
      schema: sectionAnswerSchema,
      jsonSchema: z.toJSONSchema(sectionAnswerSchema),
      messages: buildMessages(input),
      maxTokens: 2000,
    });
    const knownIds = new Set(input.units.map((unit) => unit.unitId));
    return { sentences: keepCitedSentences(value.sentences, knownIds), modelVersion: model };
  }
}

// Builds the system + user messages: the page, the section and its claims as JSON
function buildMessages(input: SectionWriteInput): ChatMessage[] {
  const claims = input.units.map((unit) => ({ unitId: unit.unitId, kind: unit.kind, status: unit.epistemicStatus, claim: unit.content }));
  const request = { page: input.pageTitle, section: input.sectionTitle, claims };
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(request) },
  ];
}

// Drops unknown unit ids, then sentences that cite nothing (or say nothing)
export function keepCitedSentences(sentences: WrittenSentence[], knownIds: ReadonlySet<string>): WrittenSentence[] {
  return sentences
    .map((sentence) => ({ text: sentence.text.trim(), unitIds: [...new Set(sentence.unitIds.filter((id) => knownIds.has(id)))] }))
    .filter((sentence) => sentence.text !== "" && sentence.unitIds.length > 0);
}
