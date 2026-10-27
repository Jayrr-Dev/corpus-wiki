import { z } from "zod";
import { SENIORITIES, STRUCTURE_LINK_TYPES } from "@/lib/stakeholders/structure";

const identity = z.object({ type: z.string().trim().min(1), key: z.string().trim().min(1) });
// A StructureLabel (lib/stakeholders/structure.ts); optional, older contexts have none
const structureLabel = z.object({
  from: identity, link: z.enum(STRUCTURE_LINK_TYPES), to: identity,
  title: z.string().trim().nullable(), seniority: z.enum(SENIORITIES).nullable(),
  share: z.number().min(0).max(1).nullable(), current: z.boolean(),
});
export const knowledgeContextSchema = z.object({
  entities: z.array(identity.extend({ role: z.enum(["subject", "object", "mentioned"]) })),
  applicability: z.object({
    status: z.enum(["unspecified", "general", "scoped"]),
    entities: z.array(identity),
    conditions: z.string().trim().nullable(),
  }),
  structure: z.array(structureLabel).optional(),
}).superRefine((value, ctx) => {
  const identities = new Map<string, string>();
  for (const entity of value.entities) {
    const key = JSON.stringify([entity.type, entity.key]);
    if (identities.has(key) && identities.get(key) !== entity.role)
      ctx.addIssue({ code: "custom", message: "An entity cannot have conflicting roles in one claim." });
    identities.set(key, entity.role);
  }
  const scope = value.applicability;
  if (scope.status !== "scoped" && (scope.entities.length || scope.conditions))
    ctx.addIssue({ code: "custom", message: "Only scoped applicability may specify entities or conditions." });
  if (scope.status === "scoped" && !scope.entities.length && !scope.conditions)
    ctx.addIssue({ code: "custom", message: "Scoped applicability needs an entity or condition." });
});
export type KnowledgeContext = z.infer<typeof knowledgeContextSchema>;
export function normalizeKnowledgeContext(value: unknown): KnowledgeContext {
  const parsed = knowledgeContextSchema.parse(value);
  const ordered = <T>(values: T[]): T[] => [...new Map(values.map(v => [JSON.stringify(v), v])).values()].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const structure = ordered((parsed.structure ?? []).map(label => ({ ...label, title: label.title || null })));
  return { entities: ordered(parsed.entities), applicability: { ...parsed.applicability, entities: ordered(parsed.applicability.entities), conditions: parsed.applicability.conditions || null },
    ...(structure.length ? { structure } : {}) };
}
export function parseKnowledgeContext(value: unknown): KnowledgeContext | null {
  try { return normalizeKnowledgeContext(value); } catch { return null; }
}
// Structure labels are about how entities relate, not where the claim holds: merging ignores them
export function contextsCompatibleForMerge(left?: KnowledgeContext | null, right?: KnowledgeContext | null): boolean {
  if (!left || !right) return false;
  const a = parseKnowledgeContext(left), b = parseKnowledgeContext(right);
  if (!a || !b || a.applicability.status === "unspecified" || b.applicability.status === "unspecified") return false;
  return JSON.stringify(a.applicability) === JSON.stringify(b.applicability)
    && JSON.stringify(a.entities.filter(e => e.role !== "mentioned")) === JSON.stringify(b.entities.filter(e => e.role !== "mentioned"));
}
export const knowledgeContextsCompatible = contextsCompatibleForMerge;
