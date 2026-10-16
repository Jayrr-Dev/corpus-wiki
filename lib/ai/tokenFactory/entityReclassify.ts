import { z } from "zod";
import type { ChatMessage } from "@/lib/ai/chat";
import { ENTITY_TYPE_GUIDE, ENTITY_TYPES, normalizeEntityType, type EntityType } from "@/lib/knowledge/entityTypes";

// =====================================================================
// ENTITY RECLASSIFY: the model reads entities filed under the fallback
// type "concept" (their name, aliases, description and a few claims) and
// names the type from the fixed list that fits each one. "concept" stays
// a valid answer: many are real terms. lib/knowledge/entityReclassify.ts
// turns the answer into retype_entity actions.
// =====================================================================

export const RECLASSIFY_PROMPT_VERSION = "entity-reclassify-v2";
export const RECLASSIFY_BATCH_SIZE = 15;

// WHAT THE MODEL READS PER ENTITY
export type ReclassifyEntity = { id: string; type: string; key: string; name: string; aliases: string[]; description: string | null; claims: string[] };

const answerSchema = z.object({
  entities: z.array(z.object({
    ref: z.string(),
    type: z.preprocess(normalizeEntityType, z.enum(ENTITY_TYPES)),
    reason: z.string().default(""),
  })),
});
export const reclassifyAnswerSchema = answerSchema;
export type ReclassifyAnswer = z.infer<typeof answerSchema>;
export const reclassifyAnswerJsonSchema = z.toJSONSchema(answerSchema);

const SYSTEM_PROMPT = `You sort the entities of a knowledge store into types. Each entity was filed as "concept" because nothing better was chosen. For each, choose the ONE type that fits best:
${ENTITY_TYPE_GUIDE}.

Answer with JSON only: { "entities": [{ "ref": "E1", "type": "document", "reason": "..." }] }, one item per entity.
- Decide by WHAT the thing is, from its name, description and claims: "Inspection Report Template" is a document, "First-Party Inspectors" a role, "Coordinate Measurement Machine" equipment.
- organization, company, government_body and person are for ONE specific, named party (EPCOR, Health Canada). A generic kind of party ("QC providers", "quality assurance agencies", "suppliers") is a role when it names a part someone plays, otherwise a concept.
- Keep "concept" for terms, ideas, methods and categories ("Hazardous Product", "Conformity to Specifications", "AQL Limits"). When unsure, keep "concept".
- reason: one short sentence.`;

const entityRef = (index: number) => `E${index + 1}`;
const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

export function buildReclassifyMessages(entities: ReclassifyEntity[]): ChatMessage[] {
  const payload = {
    entities: entities.map((entity, index) => ({
      ref: entityRef(index),
      name: entity.name,
      aliases: entity.aliases,
      description: entity.description ?? "",
      claims: entity.claims.slice(0, 6).map((claim) => clip(claim, 240)),
    })),
  };
  return [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(payload) }];
}

// ANSWER -> the retypes to make: unknown refs, repeats and "keep as it is" are dropped, and so is
// a move onto a (type, key) a live entity already holds (that is a duplicate for the tidy pass)
export function readRetypes(answer: ReclassifyAnswer, entities: ReclassifyEntity[], taken: ReadonlySet<string>): { entity: ReclassifyEntity; type: EntityType; reason: string }[] {
  const byRef = new Map(entities.map((entity, index) => [entityRef(index), entity]));
  const seen = new Set<string>();
  return answer.entities.flatMap((item) => {
    const entity = byRef.get(item.ref.trim().toUpperCase());
    if (!entity || seen.has(entity.id)) return [];
    seen.add(entity.id);
    if (item.type === entity.type || taken.has(`${item.type}:${entity.key}`)) return [];
    return [{ entity, type: item.type, reason: item.reason.trim() || `It is a ${item.type.replaceAll("_", " ")}` }];
  });
}
