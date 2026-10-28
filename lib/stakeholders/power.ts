// =====================================================================
// STAKEHOLDER POWER (browser and server): a Power Level 1 to 5 for every
// stakeholder, and how much of that power bears on our own work. Pure and
// deterministic: the AI finds facts, this file does the arithmetic.
// The algorithm is docs/power-model.md; change that first, then this file.
// Power is in staff-equivalents; score is its log10, so one level is ten
// times the one below.
// =====================================================================

import type { StakeholderCard } from "./cards";
import { cardKind } from "./cards";
import type { Seniority, StructureRelation } from "./structure";
import { SENIORITY_LADDER } from "./structure";

export type PowerLevel = 1 | 2 | 3 | 4 | 5;
// score: log10 of power in staff-equivalents (2 is about 100 staff). points: the same on a 0 to 1000
// scale, 125 points per tenfold. estimated: a default or a stale link was used
export type PowerResult = { score: number; points: number; level: PowerLevel; reasons: string[]; estimated: boolean };

// EVERY TUNING NUMBER, by the section of docs/power-model.md it comes from
export const POWER_MODEL = {
  timeWeight: { staleAfterYears: 3, stale: 0.85, formerStart: 0.5, formerHalfLifeYears: 5, formerFloor: 0.2 },
  ownMass: {
    moneyPerStaff: 200_000, populationPerStaff: 50,
    defaults: { federal: 100_000, province: 30_000, municipal: 5_000, governmentBody: 2_000, company: 200, organization: 100, team: 20 },
  },
  boxPower: {
    maxPasses: 20, settleWithin: 0.001, defaultShare: 0.3, maxShare: 1, unknownOwnerShare: 0.5, controlShare: 0.5, controlAbove: 1.1,
    pressure: { regulates: 0.1, funds: 0.1, contracts_with: 0.05 },
  },
  personPower: {
    leads: 0.5, board: 0.2, ownerControlAbove: 1.1,
    worksIn: { vice_president: 0.2, director: 0.1, manager: 0.04, lead: 0.02, staff: 0.005, entry: 0.002, advisor: 0.01, unknown: 0.01 },
    otherSeats: 0.3, bossAbove: 1.1, formerBelowHolder: 0.99,
    network: { scale: 0.1, capOfBiggestSeat: 0.5 },
    experience: { peak: 0.1, perYear: 0.01, cap: 0.25 },
    maxPasses: 20, floor: 1,
  },
  levels: { bands: [10, 100, 1_000, 10_000], pointsPerTenfold: 100, zeroAt: 0.01, maxPoints: 1000 },
  roles: { rights: { accountable: 3, responsible: 1, consulted: 0.7, informed: 0.4, unknown: 1 }, noBox: 20 },
  powerOverUs: { inUs: 1, regulates: 1, funds: 0.8, client: 0.7, perLink: 0.5, unconnected: 0.01 },
} as const;

const MAX_REASONS = 5;
const YEAR_MS = 365.25 * 24 * 3600 * 1000;

// ---------------------------------------------------------------------
// 1. TIME WEIGHT OF A LINK
// ---------------------------------------------------------------------

// "2019", "2021-03", "2021-03-15" -> a date; null when unreadable
export function parsePartialDate(text: string | null | undefined): Date | null {
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(text ?? "");
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), match[2] ? Number(match[2]) - 1 : 0, match[3] ? Number(match[3]) : 1));
}
const yearsBetween = (from: Date, to: Date) => Math.max(0, (to.getTime() - from.getTime()) / YEAR_MS);

export type TimeWeight = { t: number; stale: boolean; former: boolean };
export function timeWeight(relation: Pick<StructureRelation, "current" | "until" | "asOf">, now: Date): TimeWeight {
  const model = POWER_MODEL.timeWeight;
  const former = relation.current === false || relation.until !== null;
  if (!former) {
    const asOf = parsePartialDate(relation.asOf);
    const stale = asOf !== null && yearsBetween(asOf, now) > model.staleAfterYears;
    return { t: stale ? model.stale : 1, stale, former };
  }
  const until = parsePartialDate(relation.until);
  if (!until) return { t: model.formerFloor, stale: false, former };
  return { t: Math.max(model.formerFloor, model.formerStart * 0.5 ** (yearsBetween(until, now) / model.formerHalfLifeYears)), stale: false, former };
}

// ---------------------------------------------------------------------
// 2. OWN MASS OF A BOX
// ---------------------------------------------------------------------

const MULTIPLIERS: Record<string, number> = {
  thousand: 1e3, k: 1e3, million: 1e6, mn: 1e6, mm: 1e6, m: 1e6, billion: 1e9, bn: 1e9, b: 1e9, trillion: 1e12, tn: 1e12, t: 1e12,
};

// The biggest amount in a text ("12,000", "1.2 billion", "$3B", "45 000", "120k"), skipping years and percentages
export function parseAmount(text: string): number | null {
  const pattern = /(\d{1,3}(?:[,  ]\d{3})+|\d+(?:\.\d+)?)(?:\s*(thousand|million|billion|trillion|bn|mn|mm|tn|k|m|b|t)\b)?(\s*%)?/gi;
  let best: number | null = null;
  for (const match of text.matchAll(pattern)) {
    const [, digits, unit, percent] = match;
    if (percent) continue;
    const plain = !unit && !/[,  ]/.test(digits!);
    const value = Number(digits!.replace(/[,  ]/g, "")) * (unit ? MULTIPLIERS[unit.toLowerCase()]! : 1);
    if (plain && Number.isInteger(value) && value >= 1800 && value <= 2100) continue; // a year
    if (best === null || value > best) best = value;
  }
  return best;
}

// 12345 -> "12,000", 1234567890 -> "1.2 billion"
export function roughNumber(value: number): string {
  const rounded = Number(value.toPrecision(2));
  if (rounded >= 1e12) return `${rounded / 1e12} trillion`;
  if (rounded >= 1e9) return `${rounded / 1e9} billion`;
  if (rounded >= 1e6) return `${rounded / 1e6} million`;
  return rounded.toLocaleString("en-US");
}

const SIZE_FACTS: { pattern: RegExp; perStaff: number; reason: (amount: string) => string }[] = [
  { pattern: /population|residents|inhabitants|citizens/i, perStaff: POWER_MODEL.ownMass.populationPerStaff, reason: (n) => `Serves about ${n} people` },
  { pattern: /employ|staff|headcount|workforce|personnel/i, perStaff: 1, reason: (n) => `About ${n} employees` },
  { pattern: /revenue|sales|turnover/i, perStaff: POWER_MODEL.ownMass.moneyPerStaff, reason: (n) => `Revenue about ${n}` },
  { pattern: /budget|spending|expenditure/i, perStaff: POWER_MODEL.ownMass.moneyPerStaff, reason: (n) => `Budget about ${n}` },
  { pattern: /assets/i, perStaff: POWER_MODEL.ownMass.moneyPerStaff, reason: (n) => `Assets about ${n}` },
];

type Size = { size: number; reason: string };

// The biggest size any fact gives, in staff-equivalents
export function sizeFromFacts(facts: { label: string; value: string }[]): Size | null {
  let best: Size | null = null;
  for (const fact of facts) {
    const kind = SIZE_FACTS.find((entry) => entry.pattern.test(fact.label)) ?? SIZE_FACTS.find((entry) => entry.pattern.test(fact.value));
    const amount = kind ? parseAmount(fact.value) : null;
    if (!kind || amount === null || amount <= 0) continue;
    const size = amount / kind.perStaff;
    if (!best || size > best.size) best = { size, reason: kind.reason(roughNumber(amount)) };
  }
  return best;
}

type DefaultKind = keyof typeof POWER_MODEL.ownMass.defaults;
const DEFAULT_WORDS: Record<DefaultKind, string> = {
  federal: "a national government", province: "a provincial or state government", municipal: "a city government",
  governmentBody: "a government body", company: "a company", organization: "an organization", team: "a team",
};

function defaultKindOf(text: string): DefaultKind | null {
  if (/regulat|watchdog|ombuds/.test(text)) return "governmentBody";
  const saysGovernment = /\b(government|govt|public body|crown|ministry|municipal|municipality)\b/.test(text);
  if (!saysGovernment && /compan|corporat|business|firm|enterprise|startup|vendor|supplier|\b(inc|ltd|llc)\b/.test(text)) return "company";
  const government = saysGovernment || /\b(city|town|county|province|provincial|state|federal|national)\b/.test(text);
  if (government && /\b(agency|department|ministry|bureau|office|commission|authority|board|service|council)\b/.test(text)) return "governmentBody";
  if (government && /\b(federal|national|country)\b/.test(text)) return "federal";
  if (government && /\b(province|provincial|state|territory|territorial)\b/.test(text)) return "province";
  if (government && /\b(city|municipal|municipality|town|county|village)\b/.test(text)) return "municipal";
  if (government) return "governmentBody";
  if (/\b(team|department|division|unit|squad|group)\b/.test(text)) return "team";
  if (/nonprofit|non-profit|charity|association|union|society|foundation|organi[sz]ation|ngo|institut|universit|hospital/.test(text)) return "organization";
  return null;
}

type Mass = { mass: number; known: boolean; reason: string };
function massOf(card: StakeholderCard | undefined): Mass {
  const found = card ? sizeFromFacts([...card.keyFacts, ...(card.web?.facts ?? [])]) : null;
  if (found) return { mass: found.size, known: true, reason: found.reason };
  const kind = (card && defaultKindOf(`${cardKind(card)} ${card.type} ${card.name}`.toLowerCase())) || "organization";
  return { mass: POWER_MODEL.ownMass.defaults[kind], known: false, reason: `No size found; estimated as ${DEFAULT_WORDS[kind]}` };
}

// ---------------------------------------------------------------------
// SENIORITY from a job title, when it is obvious
// ---------------------------------------------------------------------

const TITLE_SENIORITY: [RegExp, Seniority][] = [
  [/\b(owner|co-?owner|partner|proprietor)\b/, "owner"],
  [/\b(deputy minister|city manager|chief administrative officer|cao|commissioner)\b/, "top_official"],
  [/\b(mayor|premier|prime minister|minister|governor|reeve)\b/, "elected_leader"],
  [/\b(board|chair|chairman|chairwoman|chairperson|trustee)\b/, "board"],
  [/\b(councill?or|alderman|mla|mpp|mp|senator|member of parliament|legislator)\b/, "elected_member"],
  [/\b(vice president|vice-president|vp|svp|evp|avp)\b/, "vice_president"],
  [/\b(ceo|cfo|coo|cto|cio|chief|president|founder|executive director|managing director|general manager)\b/, "executive"],
  [/\b(director|head of|superintendent)\b/, "director"],
  [/\b(manager)\b/, "manager"],
  [/\b(lead|supervisor|foreman|team leader)\b/, "lead"],
  [/\b(intern|trainee|junior|apprentice|student)\b/, "entry"],
  [/\b(consultant|advisor|adviser|contractor)\b/, "advisor"],
  [/\b(engineer|analyst|officer|inspector|clerk|specialist|coordinator|associate|assistant|technician|technologist|designer|drafter|attendant|entrant|administrator|operator|worker|staff|planner)\b/, "staff"],
];

export function seniorityFromTitle(title: string | null | undefined): Seniority | null {
  const text = (title ?? "").toLowerCase();
  if (!text.trim()) return null;
  return TITLE_SENIORITY.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

const LADDER_INDEX = new Map<Seniority, number>(SENIORITY_LADDER.map((entry, index) => [entry.seniority, index]));
// Top of the ladder is 1, the bottom is 0
const peakOf = (seniority: Seniority) => 1 - LADDER_INDEX.get(seniority)! / (SENIORITY_LADDER.length - 1);
const seniorityWord = (seniority: Seniority) => seniority.replace(/_/g, " ");

// ---------------------------------------------------------------------
// 5. LEVELS: fixed powers of ten of staff-equivalents
// ---------------------------------------------------------------------

// 0 to 1000: 100 points per tenfold from 0.01 staff-equivalents (one seat's share), so 1 is 200,
// 10,000 is 600 and 100 million is 1000
export function pointsOf(power: number): number {
  const { pointsPerTenfold, zeroAt, maxPoints } = POWER_MODEL.levels;
  return Math.round(Math.min(maxPoints, Math.max(0, Math.log10(power / zeroAt) * pointsPerTenfold)));
}

export function levelOf(power: number): PowerLevel {
  return (1 + POWER_MODEL.levels.bands.filter((band) => power >= band).length) as PowerLevel;
}

// ---------------------------------------------------------------------
// THE GRAPH
// ---------------------------------------------------------------------

type Timed = StructureRelation & TimeWeight;
type SeatLink = "leads" | "board_member_of" | "works_in" | "owned_by";
type Seat = {
  boxId: string; link: SeatLink; weight: number; seniority: Seniority | null; guessed: boolean;
  title: string | null; share: number | null; relation: Pick<Timed, "t" | "stale" | "former" | "since" | "until" | "asOf">;
};
type Node = { id: string; name: string; person: boolean; mass: Mass };
type Graph = {
  nodes: Map<string, Node>; relations: Timed[];
  ownerships: Timed[]; // owned_by edges left after cutting cycles (from owned, to owner)
  mainParent: Map<string, { id: string; viaOwner: boolean }>; // current inside links only
  seats: Map<string, Seat[]>; // person -> seats
  reports: Timed[]; // reports_to edges left after cutting cycles (from report, to boss)
};

const SEAT_LINKS = new Set(["leads", "board_member_of", "works_in"]);
const PERSON_TYPES = /^(person|people|individual)$/;
const shareOf = (relation: Pick<StructureRelation, "share">) =>
  relation.share !== null && relation.share > 0 ? Math.min(1, relation.share) : POWER_MODEL.boxPower.unknownOwnerShare;

// Drop one edge from each cycle (the lowest share, then the lowest ids) until none is left
function cutCycles(edges: Timed[], weightOf: (edge: Timed) => number): Timed[] {
  let kept = [...edges];
  for (;;) {
    const out = new Map<string, Timed[]>();
    for (const edge of kept) out.set(edge.fromId, [...(out.get(edge.fromId) ?? []), edge]);
    const state = new Map<string, "open" | "done">();
    const path: Timed[] = [];
    let cycle: Timed[] | null = null;
    const visit = (id: string): boolean => {
      state.set(id, "open");
      for (const edge of out.get(id) ?? []) {
        path.push(edge);
        if (state.get(edge.toId) === "open") { cycle = path.slice(path.findIndex((step) => step.fromId === edge.toId)); return true; }
        if (!state.has(edge.toId) && visit(edge.toId)) return true;
        path.pop();
      }
      state.set(id, "done");
      return false;
    };
    for (const id of [...out.keys()].sort()) if (!state.has(id) && visit(id)) break;
    if (!cycle) return kept;
    const drop = [...(cycle as Timed[])].sort((a, b) => weightOf(a) - weightOf(b) || `${a.fromId}${a.toId}`.localeCompare(`${b.fromId}${b.toId}`))[0]!;
    kept = kept.filter((edge) => edge !== drop);
  }
}

function seatWeight(link: SeatLink, seniority: Seniority | null, share: number | null): number {
  const model = POWER_MODEL.personPower;
  if (link === "owned_by") {
    const owned = shareOf({ share });
    return owned >= POWER_MODEL.boxPower.controlShare ? model.ownerControlAbove : owned;
  }
  if (link === "leads") return model.leads;
  if (link === "board_member_of") return model.board;
  if (seniority === null) return model.worksIn.unknown;
  if (seniority === "executive" || seniority === "top_official" || seniority === "elected_leader" || seniority === "owner") return model.leads;
  if (seniority === "board" || seniority === "elected_member") return model.board;
  return model.worksIn[seniority];
}

function buildGraph(cards: StakeholderCard[], rawRelations: StructureRelation[], now: Date): Graph {
  const cardById = new Map(cards.map((card) => [card.entityId, card]));
  const relations: Timed[] = rawRelations.filter((relation) => relation.fromId !== relation.toId).map((relation) => ({ ...relation, ...timeWeight(relation, now) }));
  const ids = [...new Set([...cards.map((card) => card.entityId), ...relations.flatMap((relation) => [relation.fromId, relation.toId])])].sort();
  const personIds = new Set(ids.filter((id) => {
    const card = cardById.get(id);
    return (card && (PERSON_TYPES.test(card.type.trim().toLowerCase()) || card.person !== null))
      || relations.some((relation) => (relation.fromId === id && (SEAT_LINKS.has(relation.link) || relation.link === "reports_to")) || (relation.toId === id && relation.link === "reports_to"));
  }));
  const isBox = (id: string) => !personIds.has(id);
  const nodes = new Map<string, Node>(ids.map((id) => [id, { id, name: cardById.get(id)?.name ?? "another stakeholder", person: personIds.has(id), mass: massOf(cardById.get(id)) }]));

  const ownerships = cutCycles(relations.filter((relation) => relation.link === "owned_by" && isBox(relation.fromId)), shareOf);
  const reports = cutCycles(relations.filter((relation) => relation.link === "reports_to" && personIds.has(relation.fromId) && personIds.has(relation.toId)), (edge) => edge.t);

  // Main parent: the box owner with the biggest share, else a part_of parent (current links only)
  const mainParent = new Map<string, { id: string; viaOwner: boolean }>();
  for (const id of ids.filter(isBox)) {
    const owner = ownerships.filter((edge) => edge.fromId === id && !edge.former).sort((a, b) => shareOf(b) - shareOf(a) || a.toId.localeCompare(b.toId))[0];
    const partOf = relations.filter((edge) => edge.fromId === id && edge.link === "part_of" && !edge.former && isBox(edge.toId)).sort((a, b) => a.toId.localeCompare(b.toId))[0];
    if (owner && isBox(owner.toId)) mainParent.set(id, { id: owner.toId, viaOwner: true });
    else if (partOf) mainParent.set(id, { id: partOf.toId, viaOwner: false });
  }
  // A part_of cycle (A in B, B in A) loses the link that closes it, so the main parents form a tree
  const settled = new Set<string>();
  for (const start of ids) {
    const path: string[] = [];
    for (let at: string | undefined = start; at !== undefined && !settled.has(at); at = mainParent.get(at)?.id) {
      if (path.includes(at)) { mainParent.delete(path[path.length - 1]!); break; }
      path.push(at);
    }
    for (const id of path) settled.add(id);
  }

  const seats = new Map<string, Seat[]>(ids.filter((id) => personIds.has(id)).map((id) => [id, []]));
  for (const relation of relations) {
    if (SEAT_LINKS.has(relation.link) && personIds.has(relation.fromId) && isBox(relation.toId)) {
      const link = relation.link as SeatLink;
      const fromTitle = seniorityFromTitle(relation.title);
      const seniority = relation.seniority ?? (link === "leads" ? "executive" : link === "board_member_of" ? "board" : fromTitle);
      seats.get(relation.fromId)!.push({
        boxId: relation.toId, link, weight: seatWeight(link, seniority, null), seniority, guessed: seniority === null,
        title: relation.title, share: null, relation,
      });
    }
    // A box owned by a person is one of that person's seats
    if (relation.link === "owned_by" && isBox(relation.fromId) && personIds.has(relation.toId)) {
      seats.get(relation.toId)!.push({
        boxId: relation.fromId, link: "owned_by", weight: seatWeight("owned_by", null, relation.share), seniority: "owner", guessed: false,
        title: null, share: relation.share, relation,
      });
    }
  }
  // A person only known through their card's organization works in it
  for (const card of cards) {
    const orgId = card.person?.organizationEntityId;
    const list = seats.get(card.entityId);
    if (!list || !orgId || !nodes.has(orgId) || !isBox(orgId) || list.some((seat) => seat.boxId === orgId)) continue;
    const seniority = seniorityFromTitle(card.person?.title);
    list.push({
      boxId: orgId, link: "works_in", weight: seatWeight("works_in", seniority, null), seniority, guessed: seniority === null,
      title: card.person?.title ?? null, share: null, relation: { t: 1, stale: false, former: false, since: null, until: null, asOf: null },
    });
  }
  return { nodes, relations, ownerships, mainParent, seats, reports };
}

// ---------------------------------------------------------------------
// PARTS: each node's power is a sum of parts, each with a reason
// ---------------------------------------------------------------------

type Part = { amount: number; reason: string; estimated: boolean; stale?: boolean };
type State = Map<string, { power: number; estimated: boolean }>;

const sum = (parts: Part[]) => parts.reduce((total, part) => total + part.amount, 0);
// Raise the total to a floor by topping up the part that earns it
function lift(parts: Part[], floor: number, reason: string, estimated: boolean) {
  const gap = floor - sum(parts);
  if (gap <= 0) return;
  const part = parts.find((entry) => entry.reason === reason);
  if (part) part.amount += gap;
  else parts.push({ amount: gap, reason, estimated });
}
const asOfNote = (relation: Pick<Timed, "stale" | "asOf">) => (relation.stale && relation.asOf ? ` (as of ${relation.asOf.slice(0, 4)})` : "");

// ---------------------------------------------------------------------
// 3. BOX POWER
// ---------------------------------------------------------------------

function boxParts(graph: Graph, node: Node, before: State): Part[] {
  const model = POWER_MODEL.boxPower;
  const power = (id: string) => before.get(id)!.power;
  const guessed = (id: string) => before.get(id)!.estimated;
  const name = (id: string) => graph.nodes.get(id)!.name;
  const parts: Part[] = [];

  // 1. Top down
  const parent = graph.mainParent.get(node.id);
  const parentNode = parent ? graph.nodes.get(parent.id)! : null;
  if (parent && !parent.viaOwner && node.mass.known && parentNode!.mass.known) {
    const ratio = Math.min(model.maxShare, node.mass.mass / parentNode!.mass.mass);
    parts.push({ amount: ratio * power(parent.id), reason: `Part of ${parentNode!.name}`, estimated: guessed(parent.id) });
    parts.push({ amount: 0, reason: node.mass.reason, estimated: false });
  } else if (parent && !node.mass.known) {
    parts.push({ amount: model.defaultShare * power(parent.id), reason: parent.viaOwner ? `Owned by ${parentNode!.name}` : `Part of ${parentNode!.name}`, estimated: true });
  } else {
    parts.push({ amount: node.mass.mass, reason: node.mass.reason, estimated: !node.mass.known });
  }

  // 3. Owners: a share of each thing it owns, and control of what it owns half or more of
  const controls: [number, string, boolean][] = [];
  for (const edge of graph.ownerships.filter((entry) => entry.toId === node.id)) {
    const share = shareOf(edge);
    const reason = `${edge.former ? "Formerly owned" : "Owns"} ${edge.share !== null ? `${Math.round(share * 100)} percent of ` : ""}${name(edge.fromId)}${asOfNote(edge)}`;
    parts.push({ amount: share * edge.t * power(edge.fromId), reason, estimated: guessed(edge.fromId) || edge.stale, stale: edge.stale });
    if (!edge.former && share >= model.controlShare) controls.push([model.controlAbove * edge.t * power(edge.fromId), reason, guessed(edge.fromId) || edge.stale]);
  }

  // 4. Pressure on others
  for (const edge of graph.relations.filter((entry) => entry.fromId === node.id && entry.link in model.pressure && !graph.nodes.get(entry.toId)!.person)) {
    const verb = edge.link === "regulates" ? "Regulates" : edge.link === "funds" ? "Funds" : "Client of";
    parts.push({
      amount: model.pressure[edge.link as keyof typeof model.pressure] * edge.t * power(edge.toId),
      reason: `${edge.former ? `Formerly ${verb.toLowerCase()}` : verb} ${name(edge.toId)}${asOfNote(edge)}`, estimated: edge.stale, stale: edge.stale,
    });
  }

  // 2. Bottom up: at least the known sizes of its parts
  const knownChildren = [...graph.mainParent].filter(([childId, entry]) => entry.id === node.id && !entry.viaOwner && graph.nodes.get(childId)!.mass.known);
  const childMass = knownChildren.reduce((total, [childId]) => total + graph.nodes.get(childId)!.mass.mass, 0);
  if (childMass > 0) lift(parts, childMass, `Its parts have about ${roughNumber(childMass)} staff`, false);
  for (const [floor, reason, estimated] of controls) lift(parts, floor, reason, estimated);
  return parts;
}

// ---------------------------------------------------------------------
// 4. PERSON POWER
// ---------------------------------------------------------------------

function seatReason(graph: Graph, seat: Seat): string {
  const box = graph.nodes.get(seat.boxId)!;
  const until = seat.relation.until ? ` until ${seat.relation.until.slice(0, 4)}` : "";
  if (seat.relation.former) {
    const role = seat.title ?? (seat.link === "leads" ? "head" : seat.link === "board_member_of" ? "board member" : seat.link === "owned_by" ? "owner" : seat.seniority ? seniorityWord(seat.seniority) : "member");
    return `Former ${role} of ${box.name}${until}`;
  }
  const parent = graph.mainParent.get(seat.boxId);
  const at = parent && !parent.viaOwner ? ` at ${graph.nodes.get(parent.id)!.name}` : "";
  const note = asOfNote(seat.relation);
  if (seat.link === "leads") return `Leads ${box.name}${at}${note}`;
  if (seat.link === "board_member_of") return `Board member of ${box.name}${note}`;
  if (seat.link === "owned_by") return `Owns ${seat.share !== null ? `${Math.round(shareOf(seat) * 100)} percent of ` : ""}${box.name}${note}`;
  return seat.title ? `${seat.title.charAt(0).toUpperCase()}${seat.title.slice(1)} at ${box.name}${note}` : `Works in ${box.name}${note}`;
}

// The value of a seat, held to below what the current holder of the same seat gets
function seatValues(graph: Graph, personId: string, boxes: State): { seat: Seat; value: number; untimed: number }[] {
  const model = POWER_MODEL.personPower;
  return graph.seats.get(personId)!.map((seat) => {
    const untimed = boxes.get(seat.boxId)!.power * seat.weight;
    let value = untimed * seat.relation.t;
    if (seat.relation.former) {
      const holders = [...graph.seats].filter(([otherId]) => otherId !== personId)
        .flatMap(([, list]) => list.filter((other) => !other.relation.former && other.boxId === seat.boxId && other.link === seat.link && other.weight === seat.weight))
        .map((other) => untimed * other.relation.t);
      if (holders.length) value = Math.min(value, model.formerBelowHolder * Math.max(...holders));
    }
    return { seat, value, untimed };
  });
}

function personParts(graph: Graph, node: Node, boxes: State, before: State, now: Date): Part[] {
  const model = POWER_MODEL.personPower;
  const parts: Part[] = [];
  const values = seatValues(graph, node.id, boxes).sort((a, b) => b.value - a.value);

  // Seats: the biggest in full, the others partly
  values.forEach(({ seat, value }, index) => parts.push({
    amount: index === 0 ? value : model.otherSeats * value, reason: seatReason(graph, seat),
    estimated: boxes.get(seat.boxId)!.estimated || seat.guessed || seat.relation.stale, stale: seat.relation.stale,
  }));

  // Network: every box seated in and every reports_to person, biggest first, each worth less by rank
  const links = new Map<string, number>();
  for (const { seat } of values) links.set(seat.boxId, Math.max(links.get(seat.boxId) ?? 0, boxes.get(seat.boxId)!.power * seat.relation.t));
  for (const edge of graph.reports.filter((entry) => entry.fromId === node.id || entry.toId === node.id)) {
    const otherId = edge.fromId === node.id ? edge.toId : edge.fromId;
    links.set(otherId, Math.max(links.get(otherId) ?? 0, before.get(otherId)!.power * edge.t));
  }
  const ranked = [...links.values()].sort((a, b) => b - a);
  const cap = model.network.capOfBiggestSeat * Math.max(0, ...values.map((entry) => entry.untimed));
  const network = Math.min(cap, model.network.scale * ranked.reduce((total, weight, index) => total + weight / (index + 1), 0));
  if (network > 0) {
    const organizations = [...links.keys()].filter((id) => !graph.nodes.get(id)!.person).length;
    const people = links.size - organizations;
    const counted = [organizations ? `${organizations} ${organizations === 1 ? "organization" : "organizations"}` : "", people ? `${people} ${people === 1 ? "person" : "people"}` : ""].filter(Boolean);
    parts.push({ amount: network, reason: `Connected to ${counted.join(" and ")}`, estimated: false });
  }

  // Experience: the highest seat ever held and years in seats
  const seniorities = values.map(({ seat }) => seat.seniority).filter((seniority): seniority is Seniority => seniority !== null);
  const peak = seniorities.length ? Math.max(...seniorities.map(peakOf)) : 0;
  const years = values.reduce((total, { seat }) => {
    const since = parsePartialDate(seat.relation.since);
    const until = seat.relation.former ? parsePartialDate(seat.relation.until) : now;
    return since && until ? total + yearsBetween(since, until) : total;
  }, 0);
  const experience = Math.min(model.experience.cap, model.experience.peak * peak + model.experience.perYear * years);
  if (experience > 0 && parts.length) {
    const top = seniorities.sort((a, b) => peakOf(b) - peakOf(a))[0];
    const reason = years >= 1 ? `About ${Math.round(years)} years in ${peak >= 0.5 ? "senior " : ""}roles` : `Has held a ${top ? seniorityWord(top) : ""} role`;
    parts.push({ amount: sum(parts) * experience, reason, estimated: false });
  }

  // A boss ranks above each current direct report
  for (const edge of graph.reports.filter((entry) => entry.toId === node.id && !entry.former)) {
    lift(parts, model.bossAbove * before.get(edge.fromId)!.power, `Manages ${graph.nodes.get(edge.fromId)!.name}`, before.get(edge.fromId)!.estimated);
  }
  if (!parts.length) parts.push({ amount: model.floor, reason: "No known role or seat yet", estimated: true });
  lift(parts, model.floor, "No known role or seat yet", true);
  return parts;
}

// ---------------------------------------------------------------------
// SETTLING: repeat the passes until nothing moves by more than 0.1 percent
// ---------------------------------------------------------------------

const biggestEstimated = (parts: Part[]) => [...parts].sort((a, b) => b.amount - a.amount)[0]?.estimated ?? true;

function settle(ids: string[], start: State, maxPasses: number, partsOf: (id: string, before: State) => Part[]) {
  let state = start;
  let parts = new Map<string, Part[]>();
  for (let pass = 0; pass < maxPasses; pass++) {
    parts = new Map(ids.map((id) => [id, partsOf(id, state)]));
    const next: State = new Map(state);
    for (const [id, list] of parts) next.set(id, { power: Math.max(sum(list), 1e-6), estimated: biggestEstimated(list) || list.some((part) => part.stale) });
    const moved = ids.some((id) => Math.abs(next.get(id)!.power - state.get(id)!.power) > POWER_MODEL.boxPower.settleWithin * next.get(id)!.power);
    state = next;
    if (!moved) break;
  }
  return { state, parts };
}

function resultOf(power: number, reasons: string[], estimated: boolean): PowerResult {
  return { score: Math.round(Math.log10(power) * 100) / 100, points: pointsOf(power), level: levelOf(power), reasons: [...new Set(reasons)].slice(0, MAX_REASONS), estimated };
}
const reasonsOf = (parts: Part[]) => {
  const merged = new Map<string, number>();
  for (const part of parts) merged.set(part.reason, (merged.get(part.reason) ?? 0) + part.amount);
  return [...merged].sort((a, b) => b[1] - a[1]).map(([reason]) => reason);
};

function computeAll(cards: StakeholderCard[], relations: StructureRelation[], now: Date) {
  const graph = buildGraph(cards, relations, now);
  const boxIds = [...graph.nodes.values()].filter((node) => !node.person).map((node) => node.id);
  const personIds = [...graph.nodes.values()].filter((node) => node.person).map((node) => node.id);
  const boxStart: State = new Map(boxIds.map((id) => [id, { power: graph.nodes.get(id)!.mass.mass, estimated: !graph.nodes.get(id)!.mass.known }]));
  const boxes = settle(boxIds, boxStart, POWER_MODEL.boxPower.maxPasses, (id, before) => boxParts(graph, graph.nodes.get(id)!, before));
  const personStart: State = new Map([...boxes.state, ...personIds.map((id): [string, { power: number; estimated: boolean }] => [id, { power: POWER_MODEL.personPower.floor, estimated: true }])]);
  const people = settle(personIds, personStart, POWER_MODEL.personPower.maxPasses, (id, before) => personParts(graph, graph.nodes.get(id)!, boxes.state, before, now));
  const results = new Map<string, PowerResult & { power: number }>();
  for (const [id, parts] of [...boxes.parts, ...people.parts]) {
    const entry = people.state.get(id)!;
    results.set(id, { ...resultOf(entry.power, reasonsOf(parts), entry.estimated), power: entry.power });
  }
  for (const card of cards.filter(isRole)) {
    const role = rolePower(card, cards, graph, people.state);
    results.set(card.entityId, { ...resultOf(role.power, role.reasons, role.estimated), power: role.power });
  }
  return { graph, results };
}

// ---------------------------------------------------------------------
// 4b. ROLES: a seat, not a party. Its organization's power, times the seat's
// share by seniority, times its decision rights (RACI: accountable,
// responsible, consulted, informed), read from the card's functions.
// ---------------------------------------------------------------------

const isRole = (card: Pick<StakeholderCard, "type">) => card.type.trim().toLowerCase() === "role";
export type DecisionRight = keyof typeof POWER_MODEL.roles.rights;
const RIGHTS: [Exclude<DecisionRight, "unknown">, RegExp][] = [
  ["accountable", /\b(approv|authori[sz]|decid|decision|sign(s|ed)? (off|the)|issu(e|es|ing) (the )?(permit|approval|licen)|grant|certif|reject|enforc|orders? (everyone|work|a stop)|stop work)/i],
  // Verbs only: "design" but not "Designer", "draft" but not "Drafting Technologist", "operate" but not "operator"
  ["responsible", /\b(complet|prepar|designs?\b|designed|designing|perform|conduct|submit|carr(y|ies) out|install|build|drafts?\b|drafted|open(s)? (a|the)|manag(e|es|ed|ing)\b|coordinat(e|es|ed|ing)\b|operat(e|es|ed|ing)\b|circulat|determin|classif|tests?\b|handle|protect|maintain|provid|manufactur)/i],
  ["consulted", /\b(review|advis|comment|recommend|assess|check|inspect|verif|examin|repl(y|ies) to)/i],
  ["informed", /\b(receiv|notified|is informed|kept informed)/i],
];

// The strongest decision right any function states, and the function that shows it
export function decisionRight(functions: string[]): { right: DecisionRight; evidence: string | null } {
  for (const [right, pattern] of RIGHTS) {
    const evidence = functions.find((text) => pattern.test(text));
    if (evidence) return { right, evidence };
  }
  return { right: "unknown", evidence: null };
}

const GENERIC_FIRST_WORDS = /^(city|town|government|province|state|american|canadian|national|international|health|the|first|third|quality|safety)$/i;
const ORG_FACT = /employer|employed|organi[sz]ation|company|issuing body|works? for|department|agency|owner/i;
function names(text: string, card: StakeholderCard): boolean {
  const lower = text.toLowerCase();
  if ([card.name, ...card.aliases].some((name) => name.trim().length >= 3 && lower.includes(name.trim().toLowerCase()))) return true;
  const first = card.name.trim().split(/\s+/)[0] ?? "";
  return first.length >= 5 && !GENERIC_FIRST_WORDS.test(first) && new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
}

// THE ROLE'S ORGANIZATION: a structure link, else a key fact naming one, else the one organization its functions name
function roleBox(card: StakeholderCard, cards: StakeholderCard[], graph: Graph): { id: string; how: string } | null {
  const linked = graph.relations.find((edge) => edge.fromId === card.entityId && INSIDE_ROLE_LINKS.has(edge.link) && !edge.former && !graph.nodes.get(edge.toId)?.person);
  if (linked) return { id: linked.toId, how: "linked" };
  const boxes = cards.filter((other) => other.entityId !== card.entityId && hasPower(other) && !isRole(other) && other.type !== "person" && other.person === null);
  for (const fact of card.keyFacts.filter((fact) => ORG_FACT.test(fact.label))) {
    const box = boxes.find((other) => names(fact.value, other));
    if (box) return { id: box.entityId, how: "fact" };
  }
  const named = boxes.filter((other) => card.functions.some((fn) => names(fn.text, other)));
  return named.length === 1 ? { id: named[0]!.entityId, how: "functions" } : null;
}
const INSIDE_ROLE_LINKS: ReadonlySet<string> = new Set(["works_in", "part_of", "leads"]);

function rolePower(card: StakeholderCard, cards: StakeholderCard[], graph: Graph, state: State): { power: number; reasons: string[]; estimated: boolean } {
  const model = POWER_MODEL.roles;
  const box = roleBox(card, cards, graph);
  const boxPower = box ? state.get(box.id)?.power ?? model.noBox : model.noBox;
  const seniority = seniorityFromTitle(card.name);
  const share = seatWeight("works_in", seniority, null);
  const { right, evidence } = decisionRight([...card.functions.map((fn) => fn.text), card.relation ?? ""].filter(Boolean));
  const boxName = box ? graph.nodes.get(box.id)?.name ?? "its organization" : null;
  const seat = seniority ? `${sentence(seniorityWord(seniority))} seat` : "Seat";
  const reasons = [
    boxName ? `${seat} at ${boxName}` : `${seat}; no organization known, estimated as a small team`,
    right === "unknown" ? "Decision rights not stated" : `${sentence(right)}: ${evidence!.replace(/\.$/, "")}`,
  ];
  const estimated = !box || (box && state.get(box.id)?.estimated !== false);
  return { power: Math.max(boxPower * share * model.rights[right], 1e-4), reasons, estimated };
}
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const withoutPower = ({ score, points, level, reasons, estimated }: PowerResult): PowerResult => ({ score, points, level, reasons, estimated });

// WHO GETS A LEVEL: everyone but a place that is not a jurisdiction (roles are scored as seats)
const JURISDICTION_KINDS = /\b(country|nation|province|state|territory|city|town|municipality|county)\b/;
export function hasPower(card: Pick<StakeholderCard, "type" | "kind">): boolean {
  const type = card.type.trim().toLowerCase();
  if (type === "place") return JURISDICTION_KINDS.test((card.kind ?? "").toLowerCase());
  return true;
}
const withLevels = (cards: StakeholderCard[], entries: [string, PowerResult][]): Map<string, PowerResult> => {
  const skipped = new Set(cards.filter((card) => !hasPower(card)).map((card) => card.entityId));
  return new Map(entries.filter(([id]) => !skipped.has(id)));
};

// General power of every stakeholder in the cards and relations, keyed by entity id
export function computePower(cards: StakeholderCard[], relations: StructureRelation[], now: Date = new Date()): Map<string, PowerResult> {
  const { results } = computeAll(cards, relations, now);
  return withLevels(cards, [...results].map(([id, result]) => [id, withoutPower(result)]));
}

// ---------------------------------------------------------------------
// 6. POWER OVER OUR WORK: general power times closeness to us
// ---------------------------------------------------------------------

type Closeness = { c: number; reason: string };

function closenessToUs(graph: Graph, ourId: string): Map<string, Closeness> {
  const model = POWER_MODEL.powerOverUs;
  const ourName = graph.nodes.get(ourId)!.name;
  const inside = graph.relations.filter((edge) => !edge.former && (edge.link === "part_of" || edge.link === "owned_by"));
  const closeness = new Map<string, Closeness>([[ourId, { c: model.inUs, reason: "Our organization" }]]);
  const better = (id: string, next: Closeness) => {
    if ((closeness.get(id)?.c ?? 0) >= next.c) return false;
    closeness.set(id, next);
    return true;
  };

  // Us: our parents and owners above, our own boxes below
  const walk = (start: string, up: boolean, reason: string) => {
    const queue = [start];
    while (queue.length) {
      const at = queue.shift()!;
      for (const edge of inside) {
        const [from, to] = up ? [edge.fromId, edge.toId] : [edge.toId, edge.fromId];
        if (from !== at || closeness.has(to)) continue;
        if (!up && edge.link === "owned_by" && shareOf(edge) < POWER_MODEL.boxPower.controlShare) continue;
        closeness.set(to, { c: model.inUs, reason });
        queue.push(to);
      }
    }
  };
  walk(ourId, true, `Above ${ourName}`);
  walk(ourId, false, `Part of ${ourName}`);
  const us = new Set(closeness.keys());

  for (const edge of graph.relations) {
    if (!us.has(edge.toId) || us.has(edge.fromId)) continue;
    const target = graph.nodes.get(edge.toId)!.name;
    if (SEAT_LINKS.has(edge.link) && !edge.former) better(edge.fromId, { c: model.inUs * edge.t, reason: `Inside ${target}` });
    if (edge.link === "regulates") better(edge.fromId, { c: model.regulates * edge.t, reason: `Regulates ${target}` });
    if (edge.link === "funds") better(edge.fromId, { c: model.funds * edge.t, reason: `Funds ${target}` });
    if (edge.link === "contracts_with") better(edge.fromId, { c: model.client * edge.t, reason: `Client of ${target}` });
  }

  // Everyone else: half per link from us, any kind, either direction, times t
  const far = new Map<string, { c: number; steps: number }>([...us].map((id) => [id, { c: 1, steps: 0 }]));
  for (let round = 0; round < graph.nodes.size; round++) {
    let changed = false;
    for (const edge of graph.relations) {
      for (const [from, to] of [[edge.fromId, edge.toId], [edge.toId, edge.fromId]] as const) {
        const near = far.get(from);
        const c = near ? near.c * model.perLink * edge.t : 0;
        if (!near || (far.get(to)?.c ?? 0) >= c) continue;
        far.set(to, { c, steps: near.steps + 1 });
        changed = true;
      }
    }
    if (!changed) break;
  }
  for (const [id, { c, steps }] of far) {
    if (!us.has(id)) better(id, { c, reason: `${steps === 1 ? "One link" : `${steps} links`} from ${ourName}` });
  }
  return closeness;
}

// Power that bears on our work: general power scaled by how close each stakeholder is to us
export function computePowerOverUs(cards: StakeholderCard[], relations: StructureRelation[], ourEntityId: string | null, now: Date = new Date()): Map<string, PowerResult> {
  const { graph, results } = computeAll(cards, relations, now);
  if (ourEntityId === null || !graph.nodes.has(ourEntityId)) return withLevels(cards, [...results].map(([id, result]) => [id, withoutPower(result)]));
  const closeness = closenessToUs(graph, ourEntityId);
  const ourName = graph.nodes.get(ourEntityId)!.name;
  return withLevels(cards, [...results].map(([id, result]): [string, PowerResult] => {
    const near = closeness.get(id) ?? { c: POWER_MODEL.powerOverUs.unconnected, reason: `Not connected to ${ourName}` };
    return [id, resultOf(Math.max(result.power * near.c, 1e-6), [near.reason, ...result.reasons], result.estimated)];
  }));
}
