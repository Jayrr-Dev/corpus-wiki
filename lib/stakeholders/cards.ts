// =====================================================================
// STAKEHOLDER CARDS (browser and server): the shape public.stakeholder_cards
// returns, contact kinds, and how kinds are named on the page. Kinds are
// whatever the card writer chose ("government agency", "role"...): the
// page builds its filters from the data, never from a fixed list.
// =====================================================================

export const CONTACT_KINDS = ["email", "phone", "website", "address", "person", "other"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];
export const CONTACT_LABELS: Record<ContactKind, string> = {
  email: "Email", phone: "Phone", website: "Website", address: "Address", person: "Contact person", other: "Other",
};

export type CardContact = { kind: ContactKind; value: string; label: string | null; unitIds?: string[] };
export type PersonContact = { kind: ContactKind; value: string; label: string | null };

export type StakeholderCard = {
  entityId: string; name: string; type: string; aliases: string[]; description: string | null;
  kind: string | null; relation: string | null;
  keyFacts: { label: string; value: string; unitIds: string[] }[];
  functions: { text: string; unitIds: string[] }[];
  contacts: CardContact[]; personContacts: PersonContact[];
  hidden: boolean; generatedAt: string | null;
  claimCount: number; sourceCount: number; lastChangedAt: string | null; stale: boolean; isOurs: boolean;
};

// The kind a card is filed under: the writer's kind, else the entity's own type
export const cardKind = (card: Pick<StakeholderCard, "kind" | "type">) => (card.kind || card.type).trim().toLowerCase();

// "government agency" -> "Government agencies" (a heading or filter label)
export function kindPlural(kind: string): string {
  const words = kind.split(" ");
  const last = words.pop() ?? "";
  const plural = /(s|x|z|ch|sh)$/.test(last) ? `${last}es` : /[^aeiou]y$/.test(last) ? `${last.slice(0, -1)}ies` : `${last}s`;
  const text = [...words, plural].join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// Initials for the card's badge: "City of Edmonton" -> "CE", "FAA" -> "FA"
export function initialsOf(name: string): string {
  const words = name.replace(/\(.*?\)/g, "").split(/[\s/&-]+/).filter((word) => /^[A-Za-z0-9]/.test(word) && !/^(of|the|and|for)$/i.test(word));
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return words.slice(0, 2).map((word) => word[0]!.toUpperCase()).join("");
}

// Every contact on a card: a person's first, then the ones from sources (a value both have shows once)
export function allContacts(card: Pick<StakeholderCard, "contacts" | "personContacts">): (CardContact & { fromPerson: boolean })[] {
  const seen = new Set<string>();
  return [...card.personContacts.map((contact) => ({ ...contact, fromPerson: true })), ...card.contacts.map((contact) => ({ ...contact, fromPerson: false }))]
    .filter((contact) => { const key = contact.value.trim().toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
}

// A link for a contact value, when it has an obvious one
export function contactHref(contact: Pick<CardContact, "kind" | "value">): string | null {
  const value = contact.value.trim();
  if (contact.kind === "email" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`;
  if (contact.kind === "phone" && /\d/.test(value)) return `tel:${value.replace(/[^\d+]/g, "")}`;
  if (contact.kind === "website") return /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return null;
}

// A person's contact list as saved: known kinds, trimmed, no blanks, at most 20
export function cleanPersonContacts(contacts: PersonContact[]): PersonContact[] {
  return contacts.flatMap((contact): PersonContact[] => {
    const value = String(contact.value ?? "").trim().slice(0, 200);
    if (!value) return [];
    const kind = (CONTACT_KINDS as readonly string[]).includes(contact.kind) ? contact.kind : "other";
    const label = String(contact.label ?? "").trim().slice(0, 80) || null;
    return [{ kind, value, label }];
  }).slice(0, 20);
}
