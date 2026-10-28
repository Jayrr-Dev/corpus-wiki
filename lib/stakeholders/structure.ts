// =====================================================================
// STAKEHOLDER STRUCTURE (browser and server): the one list of links a
// claim may label between two stakeholders, and the seniority ladders a
// seat is ranked on. Words follow the W3C ORG ontology (part of, member,
// head, reports to, post), Open Ownership BODS (shares, board seats) and
// Wikidata (owned by, parent organization). A claim carries its links in
// knowledge_context.structure; the database projects them into
// public.entity_relations, and the Power Level is computed from those.
// =====================================================================

// "inside" links nest one box in another (the map); "pressure" links cross between boxes
export const STRUCTURE_LINKS = [
  { link: "part_of", kind: "inside", label: "Part of", description: "a department, team, subsidiary, agency or ministry inside a bigger organization" },
  { link: "owned_by", kind: "inside", label: "Owned by", description: "a person or organization owns it, wholly or in part (share 0 to 1 when stated)" },
  { link: "leads", kind: "inside", label: "Leads", description: "a person heads an organization, department or team (CEO, mayor, department head, team lead)" },
  { link: "board_member_of", kind: "inside", label: "Board member of", description: "a person sits on an organization's board or council" },
  { link: "works_in", kind: "inside", label: "Works in", description: "a person works in an organization, department or team without leading it" },
  { link: "reports_to", kind: "inside", label: "Reports to", description: "a person reports to another person" },
  { link: "regulates", kind: "pressure", label: "Regulates", description: "a government body or regulator has legal authority over it" },
  { link: "funds", kind: "pressure", label: "Funds", description: "gives it money: grants, investment, budget" },
  { link: "contracts_with", kind: "pressure", label: "Contracts with", description: "hires it or buys from it as a client" },
] as const;

export type StructureLinkType = (typeof STRUCTURE_LINKS)[number]["link"];
export const STRUCTURE_LINK_TYPES = STRUCTURE_LINKS.map((entry) => entry.link) as [StructureLinkType, ...StructureLinkType[]];
export const INSIDE_LINKS: ReadonlySet<StructureLinkType> = new Set(STRUCTURE_LINKS.filter((entry) => entry.kind === "inside").map((entry) => entry.link));

// SENIORITY: most senior first. Company and government ladders share one list so seats compare.
export const SENIORITY_LADDER = [
  { seniority: "owner", label: "Owner or partner" },
  { seniority: "elected_leader", label: "Elected leader (mayor, minister, premier)" },
  { seniority: "board", label: "Board member" },
  { seniority: "elected_member", label: "Elected member (councillor, MLA, MP)" },
  { seniority: "executive", label: "Executive (CEO, CFO, president)" },
  { seniority: "top_official", label: "Top appointed official (deputy minister, city manager)" },
  { seniority: "vice_president", label: "Vice president" },
  { seniority: "director", label: "Director or senior official" },
  { seniority: "manager", label: "Manager" },
  { seniority: "lead", label: "Lead or supervisor" },
  { seniority: "staff", label: "Staff (engineer, inspector, clerk)" },
  { seniority: "entry", label: "Entry level or intern" },
  { seniority: "advisor", label: "Outside advisor or contractor" },
] as const;

export type Seniority = (typeof SENIORITY_LADDER)[number]["seniority"];
export const SENIORITIES = SENIORITY_LADDER.map((entry) => entry.seniority) as [Seniority, ...Seniority[]];

// ONE LINK AS A CLAIM LABELS IT (knowledge_context.structure[]). Both ends must also be in
// the claim's own entities. title/seniority are for a person's seat (leads, works_in,
// board_member_of); share only for owned_by; current false for a former seat or owner.
// since/until: when the link started and ended, as the passage states it ("2019",
// "2021-03", "2021-03-15"); null when not stated. until set means current is false.
export type EntityRef = { type: string; key: string };
export type StructureLabel = {
  from: EntityRef; link: StructureLinkType; to: EntityRef;
  title: string | null; seniority: Seniority | null; share: number | null; current: boolean;
  since: string | null; until: string | null;
};

// A partial ISO date: a year, a year and month, or a full date
export const PARTIAL_DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;

// ONE LINK AS public.stakeholder_structure() RETURNS IT: merged entities resolved, one row per
// (from, link, to) with every live claim that labels it. asOf: the newest source date among
// those claims (what "current" was true as of); null when no source has a date.
export type StructureRelation = {
  fromId: string; toId: string; link: StructureLinkType;
  title: string | null; seniority: Seniority | null; share: number | null; current: boolean;
  since: string | null; until: string | null; asOf: string | null;
  unitIds: string[];
};
