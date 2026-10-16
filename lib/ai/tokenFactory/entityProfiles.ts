import { createHash } from "node:crypto";
import { z } from "zod";
import type { ChatMessage } from "@/lib/ai/chat";

// =====================================================================
// STAKEHOLDER CARDS: the model reads what the store says about a batch of
// entities (their live claims and the entities named alongside them) and
// decides, for each, whether it is a stakeholder: a party that can act on
// or be affected by the work. Nothing about types is fixed here: the
// model names the kind in its own words, reusing kinds already in use so
// the page groups well. For a stakeholder it writes how it relates to our
// organization (or to the work, when none is set), key facts, functions
// and contact details, each citing the claims it came from.
// =====================================================================

export const PROFILE_PROMPT_VERSION = "entity-profiles-v1";
export const PROFILE_BATCH_SIZE = 6;

const CONTACT_KINDS = ["email", "phone", "website", "address", "person", "other"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

// WHAT THE CARD WRITER READS PER ENTITY (public.entity_profile_evidence)
export type ProfileClaim = { unitId: string; revisionId: string; title: string; content: string; kind: string; role: string };
export type ProfileEvidence = {
  entityId: string; type: string; name: string; aliases: string[]; description: string | null;
  claims: ProfileClaim[]; related: { entityId: string; name: string; type: string; shared: number }[];
};
export type OurOrganization = { name: string; description: string | null } | null;

// WHAT IS STORED (public.entity_profiles), cited claims as unit ids
export type ProfileFact = { label: string; value: string; unitIds: string[] };
export type ProfileFunction = { text: string; unitIds: string[] };
export type ProfileContact = { kind: ContactKind; value: string; label: string | null; unitIds: string[] };
export type ProfileRow = {
  entityId: string; isStakeholder: boolean; kind: string | null; relation: string | null;
  keyFacts: ProfileFact[]; functions: ProfileFunction[]; contacts: ProfileContact[];
};

const cited = z.array(z.string()).default([]);
const answerSchema = z.object({
  profiles: z.array(z.object({
    ref: z.string(),
    isStakeholder: z.boolean(),
    kind: z.string().default(""),
    relation: z.string().default(""),
    keyFacts: z.array(z.object({ label: z.string(), value: z.string(), claims: cited })).default([]),
    functions: z.array(z.object({ text: z.string(), claims: cited })).default([]),
    contacts: z.array(z.object({ kind: z.string(), value: z.string(), label: z.string().nullable().default(null), claims: cited })).default([]),
  })),
});
export const profileAnswerSchema = answerSchema;
export type ProfileAnswer = z.infer<typeof answerSchema>;
export const profileAnswerJsonSchema = z.toJSONSchema(answerSchema);

const SYSTEM_PROMPT = `You write quick-reference cards for the stakeholders in a knowledge store. For each entity you get its type, name, aliases, a short description, the claims in the store about it (refs C1, C2...) and the entities named alongside it.

Answer with JSON only: { "profiles": [{ "ref": "E1", "isStakeholder": true, "kind": "...", "relation": "...", "keyFacts": [{ "label": "...", "value": "...", "claims": ["C2"] }], "functions": [{ "text": "...", "claims": ["C1"] }], "contacts": [{ "kind": "email", "value": "...", "label": null, "claims": ["C4"] }] }] }, one item per entity.

- isStakeholder: true for a party that can act on or be affected by the work: companies, organizations, government bodies, agencies, regulators, municipalities, countries and other jurisdictions, teams, named people, and the roles people hold. False for concepts, documents, laws, standards, policies, procedures, products, tools, equipment, courses and topics. For a non-stakeholder leave every other field empty.
- kind: a short lowercase singular noun phrase for what kind of stakeholder it is (for example: company, government agency, regulator, municipality, country, organization, team, person, role). Reuse a kind from "kindsInUse" when one fits; coin a new one only when none does.
- relation: one sentence, at most 25 words, on how this stakeholder relates to OUR ORGANIZATION ("ourOrganization") when one is given, otherwise to the work described in the claims: what they do for, require of, or decide about it. For our organization itself, say what it does.
- keyFacts: at most 5 short facts a reader needs at a glance (label of 1 to 3 words, value of at most 15 words): location, jurisdiction, parent organization, certifications, size, key dates, notable events.
- functions: at most 5 things it does or is responsible for in the claims, each at most 15 words, starting with a verb.
- contacts: only contact details stated in the claims: email addresses, phone numbers, websites, street or mailing addresses, or named contact people (kind "person", value = the person's name, label = their title). kind is one of ${CONTACT_KINDS.join(", ")}.
- Every fact, function and contact cites the claim refs it comes from. Use ONLY what the claims say: no outside knowledge, no guesses. Leave a list empty rather than pad it.`;

const entityRef = (index: number) => `E${index + 1}`;
const claimRef = (index: number) => `C${index + 1}`;

export function buildProfileMessages(entities: ProfileEvidence[], ourOrganization: OurOrganization, kindsInUse: string[]): ChatMessage[] {
  const payload = {
    ourOrganization,
    kindsInUse,
    entities: entities.map((entity, index) => ({
      ref: entityRef(index),
      type: entity.type,
      name: entity.name,
      aliases: entity.aliases,
      description: entity.description ?? "",
      claims: entity.claims.map((claim, c) => ({ ref: claimRef(c), kind: claim.kind, text: claim.content })),
      namedAlongside: entity.related.map((other) => `${other.name} (${other.type})`),
    })),
  };
  return [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(payload) }];
}

// WHAT A CARD WAS WRITTEN FROM: unchanged evidence (the same claim revisions, names and anchor
// organization, under the same prompt) is not rewritten
export function profileInputHash(entity: ProfileEvidence, ourEntityId: string | null): string {
  return createHash("sha256").update(JSON.stringify({
    v: PROFILE_PROMPT_VERSION, our: ourEntityId, type: entity.type, name: entity.name, aliases: [...entity.aliases].sort(),
    claims: entity.claims.map((claim) => claim.revisionId).sort(),
  })).digest("hex");
}

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
};

// ANSWER -> one row per entity answered: refs mapped back to ids, claim refs to unit ids,
// lists capped, empty items and unknown refs dropped, kinds lowercased
export function readProfiles(answer: ProfileAnswer, entities: ProfileEvidence[]): ProfileRow[] {
  const byRef = new Map(entities.map((entity, index) => [entityRef(index), entity]));
  const seen = new Set<string>();
  return answer.profiles.flatMap((item): ProfileRow[] => {
    const entity = byRef.get(item.ref.trim().toUpperCase());
    if (!entity || seen.has(entity.entityId)) return [];
    seen.add(entity.entityId);
    if (!item.isStakeholder) return [{ entityId: entity.entityId, isStakeholder: false, kind: null, relation: null, keyFacts: [], functions: [], contacts: [] }];
    const units = (refs: string[]) => [...new Set(refs.flatMap((ref) => {
      const claim = entity.claims[Number(/^C(\d+)$/i.exec(ref.trim())?.[1]) - 1];
      return claim ? [claim.unitId] : [];
    }))];
    const kind = clip(item.kind, 40).toLowerCase().replace(/[.]+$/, "");
    return [{
      entityId: entity.entityId,
      isStakeholder: true,
      kind: kind || null,
      relation: clip(item.relation, 240) || null,
      keyFacts: item.keyFacts.filter((fact) => fact.label.trim() && fact.value.trim()).slice(0, 5)
        .map((fact) => ({ label: clip(fact.label, 40), value: clip(fact.value, 140), unitIds: units(fact.claims) })),
      functions: item.functions.filter((fn) => fn.text.trim()).slice(0, 5).map((fn) => ({ text: clip(fn.text, 140), unitIds: units(fn.claims) })),
      contacts: item.contacts.filter((contact) => contact.value.trim()).slice(0, 8).map((contact) => ({
        kind: (CONTACT_KINDS as readonly string[]).includes(contact.kind.trim().toLowerCase()) ? (contact.kind.trim().toLowerCase() as ContactKind) : "other",
        value: clip(contact.value, 200),
        label: contact.label?.trim() ? clip(contact.label, 80) : null,
        unitIds: units(contact.claims),
      })),
    }];
  });
}
