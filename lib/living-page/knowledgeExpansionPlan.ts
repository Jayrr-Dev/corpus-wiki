import { z } from "zod";
import type { DraftAction, ExistingEntity } from "@/lib/ai/types";
import type { ArticleKnowledge } from "./articlePlan";

export const expansionSchema = z.object({ concepts: z.array(z.object({
  name: z.string().min(2).max(100), key: z.string().min(2).max(100),
  type: z.enum(["concept", "policy", "procedure", "equipment", "standard"]),
  aliases: z.array(z.string()).max(6), definition: z.string().min(10).max(700),
  domainPath: z.string(), claims: z.array(z.string()).min(1), passages: z.array(z.string()).min(1),
})).max(12) });
export type KnowledgeExpansion = z.infer<typeof expansionSchema>;
export type ExpansionPassage = { id: string; text: string; sourceDate: string };
export type ExpansionContext = { knowledge: ArticleKnowledge; passages: ExpansionPassage[]; domainPaths: string[]; existingEntities: ExistingEntity[]; definedEntityKeys: string[] };
const base = { targetId: null, expectedRevisionId: null, speechAct: null, passageIds: [] };
export const naturalKey = (entity: { type: string; key: string }) => `${entity.type}:${entity.key}`;

export function validateExpansion(plan: KnowledgeExpansion, context: ExpansionContext): void {
  const seen = new Set<string>();
  for (const concept of plan.concepts) {
    const key = naturalKey(concept);
    if (seen.has(key)) throw new Error(`Repeated concept ${concept.name}`);
    seen.add(key);
    if (!context.domainPaths.includes(concept.domainPath)) throw new Error(`Unknown domain for ${concept.name}`);
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

// Definitions are real knowledge units with real source citations, not uncited UI text.
export function expansionActions(plan: KnowledgeExpansion, context: ExpansionContext): DraftAction[] {
  validateExpansion(plan, context);
  const known = new Set(context.existingEntities.map(naturalKey));
  const defined = new Set(context.definedEntityKeys);
  const actions: DraftAction[] = [];
  for (const concept of plan.concepts) {
    if (!known.has(naturalKey(concept))) {
      actions.push({ ...base, type: "create_entity", input: { type: concept.type, key: concept.key, name: concept.name, aliases: concept.aliases } });
      known.add(naturalKey(concept));
    }
    if (defined.has(naturalKey(concept))) continue;
    const passages = concept.passages.map((ref) => context.passages[Number(ref.slice(1)) - 1]!);
    const sourceDate = passages.map((passage) => passage.sourceDate).sort().at(-1)!;
    actions.push({ ...base, type: "add_claim", speechAct: "stated", passageIds: [...new Set(passages.map((passage) => passage.id))], input: {
      content: concept.definition, kind: "definition", epistemicStatus: "supported", validFrom: sourceDate,
      entities: [{ type: concept.type, key: concept.key, role: "subject" }, { type: context.knowledge.entity.type, key: context.knowledge.entity.key, role: "mentioned" }], domainPaths: [concept.domainPath],
    } });
    defined.add(naturalKey(concept));
  }
  return actions;
}
