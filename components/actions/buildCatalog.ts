import type { PersonAction } from "@/lib/change-control/types";
import { splitAliases } from "./buildCreate";

// =====================================================================
// CATALOG EDIT BUILDERS: rename and retire for entities and domains.
// Each is one typed action on an existing row (its id is the target).
// =====================================================================

// Fields every catalog edit shares: the target, no revision, evidence or speech act
const editOf = (targetId: string) => ({ targetId, expectedRevisionId: null, passageIds: [], speechAct: null });

// EDIT ENTITY -> update_entity (type and key stay)
export function buildUpdateEntity(entityId: string, name: string, aliases: string): PersonAction {
  return { type: "update_entity", ...editOf(entityId), input: { name: name.trim(), aliases: splitAliases(aliases) } };
}

// RETIRE ENTITY -> retire_entity
export function buildRetireEntity(entityId: string, reason: string): PersonAction {
  return { type: "retire_entity", ...editOf(entityId), input: { reason: reason.trim() } };
}

// RENAME DOMAIN -> update_domain (its subtree's paths follow)
export function buildRenameDomain(domainId: string, name: string): PersonAction {
  return { type: "update_domain", ...editOf(domainId), input: { name: name.trim() } };
}

// RETIRE DOMAIN -> retire_domain (its subtree too)
export function buildRetireDomain(domainId: string, reason: string): PersonAction {
  return { type: "retire_domain", ...editOf(domainId), input: { reason: reason.trim() } };
}
