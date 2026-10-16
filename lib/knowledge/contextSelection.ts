import type { KnowledgeContext } from "./context";

export type EntityIdentity = { type: string; key: string };
const sameEntity = (a: EntityIdentity, b: EntityIdentity) => a.type === b.type && a.key === b.key;

// Unknown scope is useful evidence about a subject, but never proof of applicability.
export function contextRelevance(context: KnowledgeContext, entity?: EntityIdentity): "applicable" | "contextual" | "general" | "unspecified" | "excluded" {
  if (!entity) return context.applicability.status === "scoped" ? "applicable" : context.applicability.status;
  if (context.applicability.status === "general") return "general";
  const about = context.entities.some(item => item.role !== "mentioned" && sameEntity(item, entity));
  if (context.applicability.status === "scoped") {
    if (context.applicability.entities.some(item => sameEntity(item, entity))) return "applicable";
    // A person's role at a company is still about that person; retain its
    // company/conditions as qualifications, without claiming wider applicability.
    return about ? "contextual" : "excluded";
  }
  return about ? "unspecified" : "excluded";
}

export function contextDescription(context: KnowledgeContext): string {
  const scope = context.applicability;
  const label = scope.status === "scoped" ? `Applies to: ${scope.entities.map(entity => entity.key).join(", ")}`
    : scope.status === "general" ? "General knowledge" : "Applicability unspecified";
  return `${label}${scope.conditions ? `; conditions: ${scope.conditions}` : ""}`;
}
