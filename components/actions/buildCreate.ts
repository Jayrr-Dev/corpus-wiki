import type { EntityRole, EpistemicStatus, UnitKind } from "@/lib/ai/types";
import type { PersonAction } from "@/lib/change-control/types";

// =====================================================================
// CREATE BUILDERS: the "New …" dialogs' form values -> the one typed
// action Change control receives. Pure, so the shapes are unit-tested.
// Entities and domains use the same natural keys the AI uses, so a
// person's entity and the AI's entity for the same thing are one row.
// =====================================================================

// Fields every person create shares: no target yet, no evidence, no speech act
const CREATE_BASE = { targetId: null, expectedRevisionId: null, passageIds: [], speechAct: null };

// ENTITY KEY: the lowercase name with spaces as hyphens (the reconciliation prompt's rule)
export function entityKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

// Comma-separated aliases -> a clean list
export function splitAliases(text: string): string[] {
  return text.split(",").map((alias) => alias.trim()).filter(Boolean);
}

export type NewEntityValues = { name: string; type: string; aliases: string };

// NEW ENTITY -> create_entity
export function buildCreateEntity(values: NewEntityValues): PersonAction {
  const name = values.name.trim();
  const input = { type: values.type.trim().toLowerCase(), key: entityKey(name), name, aliases: splitAliases(values.aliases) };
  return { type: "create_entity", ...CREATE_BASE, input };
}

// DOMAIN PATH: the parent's path, a slash, then the name ('Projects/Alpha')
export function domainPath(name: string, parentPath: string | null): string {
  return parentPath ? `${parentPath}/${name.trim()}` : name.trim();
}

// NEW DOMAIN -> create_domain (under a parent, or a new root)
export function buildCreateDomain(name: string, parentPath: string | null, domainTabId?: string): PersonAction {
  const input = { name: name.trim(), path: domainPath(name, parentPath), parentPath, ...(domainTabId ? { domainTabId } : {}) };
  return { type: "create_domain", ...CREATE_BASE, input };
}

export type NewClaimValues = {
  content: string;
  kind: UnitKind;
  epistemicStatus: EpistemicStatus;
  validFrom: string; // YYYY-MM-DD
  entity: { type: string; key: string } | null; // what the unit is about (its subject)
  domainPath: string | null;
};

// NEW UNIT -> add_claim (a person's claim has no passages; the entity is its subject)
export function buildAddClaim(values: NewClaimValues): PersonAction {
  const subject: EntityRole = "subject";
  const input = {
    content: values.content.trim(),
    kind: values.kind,
    epistemicStatus: values.epistemicStatus,
    validFrom: `${values.validFrom}T00:00:00Z`,
    entities: values.entity ? [{ ...values.entity, role: subject }] : [],
    domainPaths: values.domainPath ? [values.domainPath] : [],
  };
  return { type: "add_claim", ...CREATE_BASE, input };
}
