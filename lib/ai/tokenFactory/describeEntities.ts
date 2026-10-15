import { z } from "zod";
import type { ChatMessage } from "@/lib/ai/chat";

// =====================================================================
// ENTITY DESCRIPTIONS: the model reads what the store says about a batch
// of entities (the claims that mention each one, plus a few of the source
// passages they cite) and writes one or two short, factual sentences per
// entity. It may only restate the evidence; an entity the evidence says
// too little about gets an empty description (left unwritten).
// =====================================================================

// PROMPT VERSION: recorded in the AI call log under the call name
export const DESCRIBE_PROMPT_VERSION = "describe-entities-v1";

// LONGEST DESCRIPTION KEPT (a runaway answer is cut at a sentence end)
export const DESCRIPTION_MAX_CHARS = 320;

// WHAT THE MODEL SEES PER ENTITY (plus the id it never sees)
export type EntityEvidence = { entityId: string; type: string; name: string; aliases: string[]; claims: string[]; passages: string[] };

const answerSchema = z.object({ descriptions: z.array(z.object({ ref: z.string(), description: z.string() })) });
export const describeAnswerSchema = answerSchema;
export type DescribeAnswer = z.infer<typeof answerSchema>;
export const describeAnswerJsonSchema = z.toJSONSchema(answerSchema);

const SYSTEM_PROMPT = `You write short descriptions of entities (people, organizations, products, places, programs, concepts...) in a knowledge store. For each entity you get its type, name, aliases, the claims in the store that mention it and a few source passages those claims cite.

Answer with JSON only: { "descriptions": [{ "ref": "E1", "description": "..." }] }, one item per entity.
- One or two plain sentences, at most 40 words. Say what the entity is first, then its most important role or relation in the evidence.
- Use ONLY facts stated in the claims and passages. No outside knowledge, no guesses, no opinions, no hedging words like "appears to".
- Do not start with the entity's name followed by "is" when a shorter opening reads better; never repeat the type label alone ("A person.").
- If the evidence says nothing about what the entity is, return an empty description for it.`;

// Short refs (E1, E2...) instead of ids
export const entityRef = (index: number) => `E${index + 1}`;

export function buildDescribeMessages(entities: EntityEvidence[]): ChatMessage[] {
  const payload = {
    entities: entities.map((entity, index) => ({
      ref: entityRef(index),
      type: entity.type,
      name: entity.name,
      aliases: entity.aliases,
      claims: entity.claims,
      passages: entity.passages,
    })),
  };
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(payload) },
  ];
}

// ANSWER -> entity id and cleaned description; unknown refs and empty descriptions are dropped
export function describeAnswerToRows(answer: DescribeAnswer, entities: EntityEvidence[]): { entityId: string; description: string }[] {
  const idByRef = new Map(entities.map((entity, index) => [entityRef(index), entity.entityId]));
  const seen = new Set<string>();
  return answer.descriptions.flatMap((item) => {
    const entityId = idByRef.get(item.ref.trim().toUpperCase());
    const description = cleanDescription(item.description);
    if (!entityId || !description || seen.has(entityId)) return [];
    seen.add(entityId);
    return [{ entityId, description }];
  });
}

// One line, trimmed, cut at the last sentence end that fits
export function cleanDescription(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= DESCRIPTION_MAX_CHARS) return flat;
  const head = flat.slice(0, DESCRIPTION_MAX_CHARS);
  const end = head.lastIndexOf(". ");
  return end > 0 ? head.slice(0, end + 1) : `${head.trimEnd()}…`;
}
