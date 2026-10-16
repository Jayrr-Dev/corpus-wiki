import type { KnowledgeContext } from "./context";

export type EntityIdentity = { type: string; key: string };
const sameEntity = (a: EntityIdentity, b: EntityIdentity) => a.type === b.type && a.key === b.key;

// Unknown scope is useful evidence about a subject, but never proof of applicability.
export function contextRelevance(context: KnowledgeContext, entity?: EntityIdentity): "applicable" | "general" | "unspecified" | "excluded" {
  if (!entity) return context.applicability.status === "scoped" ? "applicable" : context.applicability.status;
  if (context.applicability.status === "general") return "general";
  if (context.applicability.status === "scoped") return context.applicability.entities.some(item => sameEntity(item, entity)) ? "applicable" : "excluded";
  return context.entities.some(item => item.role !== "mentioned" && sameEntity(item, entity)) ? "unspecified" : "excluded";
}

export function contextDescription(context: KnowledgeContext): string {
  const scope = context.applicability;
  const label = scope.status === "scoped" ? `Applies to: ${scope.entities.map(entity => entity.key).join(", ")}`
    : scope.status === "general" ? "General knowledge" : "Applicability unspecified";
  return `${label}${scope.conditions ? `; conditions: ${scope.conditions}` : ""}`;
}
