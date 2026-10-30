import { z } from "zod";
import { normalizeKnowledgeContext, type KnowledgeContext } from "@/lib/knowledge/context";
import { applicabilitySchema } from "@/lib/ai/tokenFactory/schema";
import type { DraftAction, ExistingEntity } from "@/lib/ai/types";
import type { ArticleKnowledge } from "./articlePlan";

export const expansionSchema = z.object({ concepts: z.array(z.object({
  name: z.string().min(2).max(100), key: z.string().min(2).max(100),
  type: z.enum(["concept", "policy", "procedure", "equipment", "standard", "legislation", "document", "tool"]),
  aliases: z.array(z.string()).max(6), definition: z.string().min(10).max(700),
  applicability: applicabilitySchema.optional(),
  domainPath: z.string(), claims: z.array(z.string()).min(1), passages: z.array(z.string()).min(1),
})).max(12) });
export type KnowledgeExpansion = z.infer<typeof expansionSchema>;
export function expansionAnswerSchema(claimCount: number, passageCount: number, domainPaths: string[] = []) {
  const refs = (count: number, prefix: string) => count
    ? z.enum(Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`) as [string, ...string[]]) : z.never();
  return expansionSchema.extend({ concepts: z.array(expansionSchema.shape.concepts.element.extend({
    domainPath: domainPaths.length ? z.enum(domainPaths as [string, ...string[]]) : z.string(),
    claims: z.array(refs(claimCount, "C")).min(1),
    passages: z.array(refs(passageCount, "P")).min(1),
  })).max(12) });
}
export type ExpansionPassage = { id: string; text: string; sourceDate: string };
export type ExpansionContext = { knowledge: ArticleKnowledge; passages: ExpansionPassage[]; domainPaths: string[]; existingEntities: ExistingEntity[]; definedEntityKeys: string[]; existingDefinitions?: { entityKey: string; context: KnowledgeContext | null }[] };
const base = { targetId: null, expectedRevisionId: null, speechAct: null, passageIds: [] };
export const naturalKey = (entity: { type: string; key: string }) => `${entity.type}:${entity.key}`;

export function validateExpansion(plan: KnowledgeExpansion, context: ExpansionContext): void {
  const seen = new Set<string>();
  for (const concept of plan.concepts) {
    const key = naturalKey(concept);
    if (seen.has(key)) throw new Error(`Repeated concept ${concept.name}`);
    seen.add(key);
    if (!context.domainPaths.includes(concept.domainPath)) throw new Error(`Unknown domain for ${concept.name}`);
    const scope = concept.applicability;
    if (scope && scope.status !== "scoped" && (scope.entities.length || scope.conditions?.trim())) throw new Error("Only scoped definitions may name scope entities");
    if (scope?.status === "scoped" && !scope.entities.length && !scope.conditions?.trim()) throw new Error("Scoped definition requires entities or conditions");
    for (const entity of scope?.entities ?? []) {
      if (!context.existingEntities.some((known) => naturalKey(known) === naturalKey(entity)) && naturalKey(entity) !== naturalKey(context.knowledge.entity)) throw new Error(`Unknown applicability entity ${entity.name}`);
    }
    for (const ref of concept.claims) {
      const match = /^C([1-9]\d*)$/.exec(ref);
      if (!match || !context.knowledge.units[Number(match[1]) - 1]) throw new Error(`Unknown claim ${ref}`);
    }
    for (const ref of concept.passages) {
      const match = /^P([1-9]\d*)$/.exec(ref);
      if (!match || !context.passages[Number(match[1]) - 1]) throw new Error(`Unknown source passage ${ref}`);
    }
  }
}

// Same words, ignoring case, spacing and end punctuation
const sameText = (text: string) => text.toLowerCase().replace(/\s+/g, " ").replace(/[\s.!?;:]+$/, "").trim();

// Definitions are real knowledge units with real source citations, not uncited UI text.
// A "definition" that only repeats a claim word for word adds a copy, not a meaning: it is skipped.
export function expansionActions(plan: KnowledgeExpansion, context: ExpansionContext): DraftAction[] {
  validateExpansion(plan, context);
  const known = new Set(context.existingEntities.map(naturalKey));
  const defined = new Set(context.definedEntityKeys);
  const said = new Set(context.knowledge.units.map((unit) => sameText(unit.content)));
  const actions: DraftAction[] = [];
  for (const concept of plan.concepts) {
    if (!known.has(naturalKey(concept))) {
      actions.push({ ...base, type: "create_entity", input: { type: concept.type, key: concept.key, name: concept.name, aliases: concept.aliases } });
      known.add(naturalKey(concept));
    }
    if (!context.existingDefinitions && defined.has(naturalKey(concept))) continue;
    const passages = concept.passages.map((ref) => context.passages[Number(ref.slice(1)) - 1]!);
    const sourceDate = passages.map((passage) => passage.sourceDate).sort().at(-1)!;
    const entities = [{ type: concept.type, key: concept.key, role: "subject" as const }];
    const applicability = concept.applicability ? { ...concept.applicability, entities: concept.applicability.entities.map(({ type, key }) => ({ type, key })), conditions: concept.applicability.conditions?.trim() || null } : { status: "unspecified" as const, entities: [], conditions: null };
    const definitionContext = normalizeKnowledgeContext({ entities, applicability });
    // Scope is part of a definition's identity. A generic definition does not suppress
    // a company's specific version, and company membership is not needed for reuse.
    const alreadyDefined = context.existingDefinitions?.some((definition) => definition.entityKey === naturalKey(concept)
      && definition.context && JSON.stringify(normalizeKnowledgeContext(definition.context).applicability) === JSON.stringify(definitionContext.applicability));
    if (alreadyDefined || said.has(sameText(concept.definition))) continue;
    said.add(sameText(concept.definition));
    actions.push({ ...base, type: "add_claim", speechAct: "stated", passageIds: [...new Set(passages.map((passage) => passage.id))], input: {
      content: concept.definition, kind: "definition", epistemicStatus: "supported", validFrom: sourceDate,
      entities, context: definitionContext, domainPaths: [concept.domainPath],
    } });
    defined.add(naturalKey(concept));
  }
  return actions;
}
