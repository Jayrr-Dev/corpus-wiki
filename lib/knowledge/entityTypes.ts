// =====================================================================
// ENTITY TYPES: the one fixed list of kinds of things the store knows.
// public.entity_types holds the same rows (20261111100000_entity_types.sql)
// and entities.type references it, so a type outside this list can't be
// saved. Extraction may only answer with these (guided decoding), and a
// stray word from an older answer is mapped by normalizeEntityType.
// =====================================================================

export type EntityTypeInfo = {
  type: string;
  parent: string | null;
  label: string;
  description: string;
  // Who or what the work deals with as a party (a stakeholder card), rather than a subject
  stakeholder: boolean;
  // Can own context: a topic root, an organization overview page, a review context
  ownsContext: boolean;
};

export const ENTITY_TYPE_LIST = [
  { type: "organization", parent: null, label: "Organization", description: "an association, institute or other body that is not a company or government", stakeholder: true, ownsContext: true },
  { type: "company", parent: "organization", label: "Company", description: "a business: contractor, supplier, utility, manufacturer", stakeholder: true, ownsContext: true },
  { type: "government_body", parent: "organization", label: "Government body", description: "a government, ministry, agency, regulator, program or municipality", stakeholder: true, ownsContext: true },
  { type: "person", parent: null, label: "Person", description: "a named individual", stakeholder: true, ownsContext: true },
  { type: "role", parent: null, label: "Role", description: "a job or function people hold: designer, inspector, administrator", stakeholder: true, ownsContext: false },
  { type: "team", parent: null, label: "Team", description: "a department, crew or working group", stakeholder: true, ownsContext: true },
  { type: "place", parent: null, label: "Place", description: "a country, province, city, site or region", stakeholder: true, ownsContext: false },
  { type: "project", parent: null, label: "Project", description: "a named project or program of work", stakeholder: false, ownsContext: true },
  { type: "product", parent: null, label: "Product", description: "a product or model that is made or sold", stakeholder: false, ownsContext: true },
  { type: "tool", parent: null, label: "Tool", description: "software or a digital system", stakeholder: false, ownsContext: false },
  { type: "equipment", parent: null, label: "Equipment", description: "physical equipment, machines or instruments", stakeholder: false, ownsContext: false },
  { type: "document", parent: null, label: "Document", description: "a template, form, report, manual or drawing", stakeholder: false, ownsContext: false },
  { type: "standard", parent: null, label: "Standard", description: "a published standard, code or specification (ISO, CSA, MIL-STD)", stakeholder: false, ownsContext: false },
  { type: "legislation", parent: null, label: "Legislation", description: "an act, law or regulation made by a government", stakeholder: false, ownsContext: false },
  { type: "policy", parent: null, label: "Policy", description: "a policy an organization sets for itself", stakeholder: false, ownsContext: false },
  { type: "procedure", parent: null, label: "Procedure", description: "a named procedure or process", stakeholder: false, ownsContext: false },
  { type: "course", parent: null, label: "Course", description: "a training course", stakeholder: false, ownsContext: false },
  { type: "concept", parent: null, label: "Concept", description: "a term or idea; use only when no other type fits", stakeholder: false, ownsContext: false },
] as const satisfies readonly EntityTypeInfo[];

export type EntityType = (typeof ENTITY_TYPE_LIST)[number]["type"];

export const ENTITY_TYPES = ENTITY_TYPE_LIST.map((entry) => entry.type) as [EntityType, ...EntityType[]];

const BY_TYPE = new Map<string, EntityTypeInfo>(ENTITY_TYPE_LIST.map((entry) => [entry.type, entry]));

// Words models and older answers used for a type, mapped to the list
const SYNONYMS: Record<string, EntityType> = {
  org: "organization", association: "organization", institute: "organization", institution: "organization", body: "organization", union: "organization",
  business: "company", corporation: "company", firm: "company", contractor: "company", supplier: "company", vendor: "company", utility: "company", manufacturer: "company",
  government: "government_body", agency: "government_body", regulator: "government_body", ministry: "government_body", department_of_government: "government_body",
  municipality: "government_body", city_government: "government_body", government_agency: "government_body",
  people: "person", individual: "person", employee: "person",
  job: "role", position: "role", job_title: "role", function: "role",
  department: "team", group: "team", crew: "team",
  country: "place", province: "place", state: "place", city: "place", region: "place", location: "place", site: "place", jurisdiction: "place",
  program: "project",
  software: "tool", system: "tool", application: "tool", app: "tool", platform: "tool",
  machine: "equipment", instrument: "equipment", device: "equipment",
  template: "document", form: "document", report: "document", manual: "document", drawing: "document", record: "document",
  specification: "standard", code: "standard",
  law: "legislation", act: "legislation", regulation: "legislation", regulations: "legislation", statute: "legislation",
  process: "procedure", method: "procedure",
  training: "course",
  term: "concept", topic: "concept", idea: "concept",
};

// Any type word -> a type on the list; unknown words fall back to "concept"
export function normalizeEntityType(raw: unknown): EntityType {
  const word = typeof raw === "string" ? raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") : "";
  if (BY_TYPE.has(word)) return word as EntityType;
  const singular = word.replace(/ies$/, "y").replace(/s$/, "");
  if (BY_TYPE.has(singular)) return singular as EntityType;
  return SYNONYMS[word] ?? SYNONYMS[singular] ?? "concept";
}

// Whether a type is a party to the work; null for "concept", which says too little to decide
export function typeIsStakeholder(type: string): boolean | null {
  if (type === "concept") return null;
  return BY_TYPE.get(type)?.stakeholder ?? null;
}

// Types whose entities can own context (public.entity_types.owns_context)
export const CONTEXT_OWNER_TYPES: string[] = ENTITY_TYPE_LIST.filter((entry) => entry.ownsContext).map((entry) => entry.type);

export function typeOwnsContext(type: string): boolean {
  return BY_TYPE.get(type)?.ownsContext ?? false;
}

// An organization of any kind: company, government body or other organization
export function typeIsOrganization(type: string): boolean {
  return type === "organization" || BY_TYPE.get(type)?.parent === "organization";
}

export function entityTypeLabel(type: string): string {
  return BY_TYPE.get(type)?.label ?? type;
}

// One line per type, for prompts
export const ENTITY_TYPE_GUIDE = ENTITY_TYPE_LIST.map((entry) => `${entry.type} (${entry.description})`).join("; ");
