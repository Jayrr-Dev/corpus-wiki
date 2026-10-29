import type { GlossaryCitation, GlossaryEntry } from "@/lib/glossary/entries";
import type { GraphRows } from "@/lib/graph/rows";
import type { RelationshipType } from "@/lib/graph/types";
import type { StakeholderCard } from "@/lib/stakeholders/cards";
import { fakeDate, fakeId, PEOPLE, SOURCES, type PersonKey, type SourceKey } from "./core";

// =====================================================================
// CONNECT SCENES: the rows behind the graph, glossary and stakeholders
// shots ("And it connects everything"). Plain data built from the core
// cast and files, so every id lines up with the other scenes.
// =====================================================================

// ---------------------------------------------------------------------
// GRAPH: five topic domains, the claims filed in them, and the people
// and systems those claims are about
// ---------------------------------------------------------------------

export const GRAPH_DOMAINS = ["Phoenix release", "Operations", "Retail", "Security", "Finance"] as const;
type Domain = (typeof GRAPH_DOMAINS)[number];

// Systems and bodies the claims name, besides the people
const SYSTEMS = ["Phoenix", "PayCore", "Ledgerly", "Change advisory board", "Kanban board"] as const;
type System = (typeof SYSTEMS)[number];

type Claim = { key: string; domain: Domain; text: string; about: (PersonKey | System)[]; source: SourceKey; kind?: GraphRows["units"][number]["kind"] };

const CLAIMS: Claim[] = [
  { key: "launch-date", domain: "Phoenix release", text: "Phoenix goes live on Friday 10 April at 18:00.", about: ["Phoenix", "sarah"], source: "launchThread", kind: "decision" },
  { key: "runbook-steps", domain: "Phoenix release", text: "The release runbook has 41 steps; Brent ran steps 12 to 30 by hand.", about: ["Phoenix", "brent"], source: "runbook", kind: "procedure" },
  { key: "rollback", domain: "Phoenix release", text: "Rollback means restoring the 17:00 database snapshot first.", about: ["Phoenix", "brent"], source: "runbook", kind: "procedure" },
  { key: "smoke-tests", domain: "Phoenix release", text: "Smoke tests must pass on staging before the change window opens.", about: ["Phoenix", "wes"], source: "runbook", kind: "procedure" },
  { key: "cab-approval", domain: "Phoenix release", text: "Every Phoenix change needs change advisory board approval.", about: ["Change advisory board", "Phoenix", "patty"], source: "cabMinutes", kind: "decision" },
  { key: "freeze", domain: "Phoenix release", text: "Code freeze starts Wednesday 8 April.", about: ["Phoenix", "wes"], source: "opsChannel", kind: "decision" },
  { key: "brent-only", domain: "Phoenix release", text: "Only Brent knew the order of the database migrations.", about: ["brent", "Phoenix"], source: "handover" },
  { key: "handover", domain: "Phoenix release", text: "Brent recorded a handover walkthrough on 1 April.", about: ["brent", "bill"], source: "handover" },

  { key: "wip-limit", domain: "Operations", text: "The operations team caps work in progress at three items each.", about: ["Kanban board", "bill"], source: "unplannedWork", kind: "decision" },
  { key: "unplanned-share", domain: "Operations", text: "Unplanned work took 62% of operations time in Q1.", about: ["patty", "bill"], source: "unplannedWork" },
  { key: "sev1-payroll", domain: "Operations", text: "The payroll outage on 18 February was a Sev 1.", about: ["wes", "brent"], source: "postmortem" },
  { key: "sev1-cause", domain: "Operations", text: "The Sev 1 started with an unapproved SAN firmware change.", about: ["brent", "Change advisory board"], source: "postmortem" },
  { key: "pager", domain: "Operations", text: "Wes owns the on-call rota for distributed systems.", about: ["wes"], source: "opsChannel" },
  { key: "cab-weekly", domain: "Operations", text: "The change advisory board meets every Tuesday at 10:00.", about: ["Change advisory board", "patty"], source: "cabMinutes", kind: "procedure" },
  { key: "kanban", domain: "Operations", text: "All operations work goes through the Kanban board first.", about: ["Kanban board", "patty"], source: "unplannedWork", kind: "procedure" },
  { key: "three-ways", domain: "Operations", text: "Erik coached the team on the Three Ways: flow, feedback, learning.", about: ["erik", "bill"], source: "opsChannel" },

  { key: "store-traffic", domain: "Retail", text: "Phoenix must handle the holiday promotion traffic peak.", about: ["sarah", "Phoenix"], source: "launchThread" },
  { key: "promo", domain: "Retail", text: "The spring promotion launches the same weekend as Phoenix.", about: ["sarah"], source: "launchThread", kind: "decision" },
  { key: "pos", domain: "Retail", text: "Store point-of-sale terminals call PayCore for every card payment.", about: ["PayCore"], source: "declinesThread" },
  { key: "declines", domain: "Retail", text: "PayCore declined 4% of card payments during the March peak.", about: ["PayCore", "dick"], source: "declinesThread" },
  { key: "sarah-launch", domain: "Retail", text: "Sarah promised the board a launch date before testing ended.", about: ["sarah", "erik"], source: "launchThread" },

  { key: "audit", domain: "Security", text: "The SOX audit found 12 findings in change control.", about: ["john", "Change advisory board"], source: "auditFindings" },
  { key: "pci", domain: "Security", text: "Card data must never be stored on the Phoenix web tier.", about: ["john", "Phoenix"], source: "auditFindings", kind: "decision" },
  { key: "access", domain: "Security", text: "Production access is reviewed every quarter by John.", about: ["john"], source: "auditFindings", kind: "procedure" },
  { key: "ledgerly-review", domain: "Security", text: "Ledgerly passed the security review on 20 March.", about: ["Ledgerly", "john"], source: "cutoverPlan" },

  { key: "paycore-end", domain: "Finance", text: "The PayCore contract ends on 30 June.", about: ["PayCore", "dick"], source: "cutoverPlan" },
  { key: "ledgerly-move", domain: "Finance", text: "Payments move from PayCore to Ledgerly in May.", about: ["Ledgerly", "PayCore", "dick"], source: "cutoverPlan", kind: "decision" },
  { key: "cutover-owner", domain: "Finance", text: "Brent wrote the Ledgerly cutover plan before he left.", about: ["Ledgerly", "brent"], source: "cutoverPlan" },
  { key: "budget", domain: "Finance", text: "Dick froze new IT spending until Phoenix ships.", about: ["dick", "bill"], source: "declinesThread", kind: "decision" },
  { key: "fees", domain: "Finance", text: "Ledgerly charges 0.4% less per card payment than PayCore.", about: ["Ledgerly", "PayCore"], source: "cutoverPlan" },
];

// Links between claims: [from, to, type]
const RELATIONS: [string, string, RelationshipType][] = [
  ["rollback", "runbook-steps", "part_of"],
  ["smoke-tests", "runbook-steps", "part_of"],
  ["launch-date", "cab-approval", "depends_on"],
  ["freeze", "launch-date", "depends_on"],
  ["brent-only", "runbook-steps", "related_to"],
  ["handover", "brent-only", "supports"],
  ["sev1-cause", "sev1-payroll", "derived_from"],
  ["sev1-cause", "cab-approval", "related_to"],
  ["unplanned-share", "wip-limit", "related_to"],
  ["kanban", "wip-limit", "supports"],
  ["cab-weekly", "cab-approval", "supports"],
  ["three-ways", "kanban", "related_to"],
  ["store-traffic", "launch-date", "related_to"],
  ["promo", "launch-date", "contradicts"],
  ["sarah-launch", "launch-date", "supports"],
  ["declines", "pos", "related_to"],
  ["declines", "ledgerly-move", "supports"],
  ["audit", "cab-approval", "supports"],
  ["pci", "store-traffic", "related_to"],
  ["ledgerly-review", "ledgerly-move", "supports"],
  ["paycore-end", "ledgerly-move", "depends_on"],
  ["cutover-owner", "ledgerly-move", "part_of"],
  ["fees", "ledgerly-move", "supports"],
  ["budget", "launch-date", "depends_on"],
];

const PEOPLE_KEYS = Object.keys(PEOPLE) as PersonKey[];
const isPerson = (key: string): key is PersonKey => (PEOPLE_KEYS as string[]).includes(key);
const entityId = (key: PersonKey | System) => (isPerson(key) ? PEOPLE[key].id : fakeId("entity", key));
const unitId = (key: string) => fakeId("unit", key);
const domainId = (domain: Domain) => fakeId("domain", domain);

// Spread creation over March so the order of the replay matches the story
const createdAt = (index: number) => fakeDate(`2026-03-${String(2 + (index % 27)).padStart(2, "0")}`, "10:00");

export const GRAPH_ROWS: GraphRows = {
  units: CLAIMS.map((claim, index) => ({
    id: unitId(claim.key),
    kind: claim.kind ?? "fact",
    epistemic_status: "established",
    current_revision_id: fakeId("revision", claim.key),
    created_at: createdAt(index),
    last_changed_at: createdAt(index),
  })),
  revisions: CLAIMS.map((claim) => ({ id: fakeId("revision", claim.key), content: claim.text })),
  relationships: RELATIONS.map(([from, to, type]) => ({ id: fakeId("relationship", from, to), from_unit_id: unitId(from), to_unit_id: unitId(to), type })),
  entities: [
    ...PEOPLE_KEYS.map((key) => ({ id: PEOPLE[key].id, name: PEOPLE[key].name, created_at: fakeDate("2026-03-01"), stakeholder: true })),
    ...SYSTEMS.map((name) => ({ id: entityId(name), name, created_at: fakeDate("2026-03-01") })),
  ],
  unitEntities: CLAIMS.flatMap((claim) => claim.about.map((key) => ({ unit_id: unitId(claim.key), entity_id: entityId(key) }))),
  domains: GRAPH_DOMAINS.map((path) => ({ id: domainId(path), path, parent_id: null })),
  unitDomains: CLAIMS.map((claim) => ({ unit_id: unitId(claim.key), domain_id: domainId(claim.domain) })),
  pages: [],
  sections: [],
  sectionInputs: [],
  sources: Object.values(SOURCES).map((source) => ({ id: source.id, origin: "internal" })),
  sourceUnits: CLAIMS.map((claim) => ({ source_id: SOURCES[claim.source].id, unit_id: unitId(claim.key) })),
};

// ---------------------------------------------------------------------
// GLOSSARY: seven terms, in the order they pop in
// ---------------------------------------------------------------------

function cite(source: SourceKey, claimKey: string): GlossaryCitation {
  return { unitId: unitId(claimKey), revisionId: fakeId("revision", claimKey), sourceId: SOURCES[source].id, sourceTitle: SOURCES[source].title };
}

function term(values: Pick<GlossaryEntry, "term" | "category" | "definition" | "citations"> & Partial<GlossaryEntry>): GlossaryEntry {
  return { expansion: null, aliases: [], context: null, scopeKey: "general", meaningId: fakeId("meaning", values.term), ...values };
}

export const GLOSSARY_ENTRIES: GlossaryEntry[] = [
  term({ term: "Change advisory board", aliases: ["CAB"], category: "jargon", definition: "The weekly meeting that approves or rejects every change to production systems.", citations: [cite("cabMinutes", "cab-weekly"), cite("auditFindings", "audit")] }),
  term({ term: "Unplanned work", category: "jargon", definition: "Firefighting and urgent fixes that push planned projects aside.", citations: [cite("unplannedWork", "unplanned-share")] }),
  term({ term: "Sev 1", expansion: "Severity 1 incident", category: "acronym", definition: "An outage that stops a core business service, such as payroll or payments.", citations: [cite("postmortem", "sev1-payroll")] }),
  term({ term: "Work in progress", aliases: ["WIP"], category: "general term", definition: "Work started but not finished; the team caps it at three items each.", citations: [cite("unplannedWork", "wip-limit")] }),
  term({ term: "Deployment pipeline", category: "technical term", definition: "The automated path that builds, tests and releases Phoenix code.", citations: [cite("runbook", "smoke-tests")] }),
  term({ term: "Kanban board", category: "technical term", definition: "The shared board where all operations work is queued and tracked.", citations: [cite("unplannedWork", "kanban")] }),
  term({ term: "The Three Ways", category: "uncommon word", definition: "Erik's three principles: fast flow, fast feedback, and continual learning.", citations: [cite("opsChannel", "three-ways")] }),
];

// What readGlossaryView returns once the glossary is ready, plus the screen's own `active` flag
export const GLOSSARY_VIEW = {
  entries: GLOSSARY_ENTRIES,
  live_entries: [],
  pending_entries: [],
  generated_at: fakeDate("2026-04-02", "08:30"),
  status: "ready" as const,
  completed_batches: 2,
  total_batches: 2,
  error: null,
  lease_until: null,
  review_progress: null,
  active: false,
};

// ---------------------------------------------------------------------
// STAKEHOLDERS: six people cards, Brent first (the order they land), and
// Parts Unlimited itself, which gives each person a seat to rank power by
// ---------------------------------------------------------------------

const ORG_ID = fakeId("entity", "Parts Unlimited");

type CardInput = { key: PersonKey; description: string; relation: string; facts: [string, string][]; functions: string[]; claims: number; sources: number };

function personCard({ key, description, relation, facts, functions, claims, sources }: CardInput): StakeholderCard {
  const person = PEOPLE[key];
  const units = [fakeId("unit", "card", key)];
  return {
    entityId: person.id, name: person.name, type: "person", aliases: [], description,
    kind: "person", relation,
    keyFacts: facts.map(([label, value]) => ({ label, value, unitIds: units })),
    functions: functions.map((text) => ({ text, unitIds: units })),
    contacts: [{ kind: "email", value: person.email, label: null, unitIds: units }], personContacts: [],
    hidden: false, generatedAt: fakeDate("2026-04-02", "08:30"),
    web: null, webCheckedAt: null, logoUrl: null,
    person: { title: person.role, organization: "Parts Unlimited", organizationEntityId: ORG_ID, role: person.role, unitIds: units },
    claimCount: claims, sourceCount: sources, lastChangedAt: fakeDate("2026-04-02", "08:30"), stale: false, isOurs: false,
  };
}

export const STAKEHOLDER_CARDS: StakeholderCard[] = [
  personCard({
    key: "brent", description: "Lead engineer who ran the Phoenix release and the Ledgerly cutover by hand.",
    relation: "Left on 3 April 2026. His knowledge now lives in the Phoenix pages.",
    facts: [["Status", "Left, last day 3 Apr 2026"], ["Owned", "Phoenix runbook, database migrations"]],
    functions: ["Ran runbook steps 12 to 30", "Wrote the Ledgerly cutover plan"], claims: 46, sources: 7,
  }),
  personCard({
    key: "bill", description: "VP of IT Operations; inherits Brent's work on Phoenix.",
    relation: "Owns the Phoenix launch and the operations team.",
    facts: [["Reports to", "Steve Masters, CEO"], ["Team", "IT Operations"]],
    functions: ["Signs off the Phoenix release", "Sets operations priorities"], claims: 31, sources: 6,
  }),
  personCard({
    key: "wes", description: "Director of Distributed Technology; runs the servers Phoenix ships to.",
    relation: "Owns the on-call rota and the change window.",
    facts: [["Team", "Distributed systems"], ["On call", "Weeknights"]],
    functions: ["Runs smoke tests on staging", "Leads the payroll postmortem"], claims: 22, sources: 4,
  }),
  personCard({
    key: "patty", description: "Director of IT Service Support; chairs the change advisory board.",
    relation: "Approves every Phoenix change.",
    facts: [["Chairs", "Change advisory board"], ["Meets", "Tuesdays, 10:00"]],
    functions: ["Keeps the unplanned work log", "Runs the Kanban board"], claims: 19, sources: 3,
  }),
  personCard({
    key: "erik", description: "Board member and advisor who coaches the team on flow.",
    relation: "Advises Bill on the Three Ways.",
    facts: [["Role", "Board member"], ["Focus", "Flow and feedback"]],
    functions: ["Coaches the operations team"], claims: 9, sources: 2,
  }),
  personCard({
    key: "sarah", description: "SVP of Retail Operations; set the Phoenix launch date.",
    relation: "Needs Phoenix live for the spring promotion.",
    facts: [["Team", "Retail Operations"], ["Wants", "Launch by 10 April"]],
    functions: ["Owns the spring promotion"], claims: 14, sources: 2,
  }),
  {
    entityId: ORG_ID, name: "Parts Unlimited", type: "organization", aliases: [], description: "Auto parts maker and retailer; the company behind Phoenix.",
    kind: "company", relation: "Our organization.", keyFacts: [], functions: [], contacts: [], personContacts: [],
    hidden: false, generatedAt: fakeDate("2026-04-02", "08:30"), web: null, webCheckedAt: null, logoUrl: null, person: null,
    claimCount: 58, sourceCount: 11, lastChangedAt: fakeDate("2026-04-02", "08:30"), stale: false, isOurs: true,
  },
];
