// =====================================================================
// STAKEHOLDER POWER (browser and server): a Power Level 1 to 5 for every
// stakeholder, computed from cards and structure links. Pure and
// deterministic: the AI finds facts, this file does the arithmetic.
//
// Method: a top box's power is its size (staff, or staff-equivalents from
// revenue, budget, assets or population) on a log scale. A box inside
// another gets a share of it. A person gets a share of each box they sit in
// by seniority. Owners gain a share of what they own and rank above it.
// Power is in staff-equivalents; score is its log10, so one level is ten
// times the one below.
// =====================================================================

import type { StakeholderCard } from "./cards";
import { cardKind } from "./cards";
import type { Seniority, StructureRelation } from "./structure";

export type PowerLevel = 1 | 2 | 3 | 4 | 5;
// score: log10 of power in staff-equivalents (2 is about 100 staff). estimated: rests on a default, not a found number
export type PowerResult = { score: number; level: PowerLevel; reasons: string[]; estimated: boolean };

// A person's share of a box they sit in, by seniority (monotone with SENIORITY_LADDER)
export const SENIORITY_WEIGHT: Record<Seniority, number> = {
  owner: 0.8, elected_leader: 0.6, board: 0.45, elected_member: 0.35, executive: 0.3, top_official: 0.25,
  vice_president: 0.12, director: 0.06, manager: 0.025, lead: 0.012, staff: 0.003, entry: 0.0015, advisor: 0.001,
};

const DEFAULT_CHILD_SHARE = 0.3; // a box inside another, sizes unknown
const MAX_CHILD_SHARE = 0.9; // a part is never as big as its whole
const EXTRA_PARENT_SHARE = 0.5; // a second parent passes half
const UNKNOWN_OWNER_SHARE = 0.5; // owned_by with no share stated
const OWNER_DAMPING = 0.85; // owning passes slightly less than the whole, so ownership cycles settle
const OWNER_ABOVE = 1.1; // the main owner ranks at least this far above what it owns
const OTHER_SEAT_SHARE = 0.25; // a person's second and later seats count partly
const REPORTS_TO_SHARE = 0.2; // a person known only by whom they report to
const REGULATOR_BONUS = 3; // legal authority over others
const PERSON_FLOOR = 1; // a person with nothing known
const MAX_ITERATIONS = 100;
const MAX_REASONS = 4;

// ---------------------------------------------------------------------
// NUMBERS IN FACTS: "12,000", "1.2 billion", "$3B", "45 000", "120k"
// ---------------------------------------------------------------------

const MULTIPLIERS: Record<string, number> = {
  thousand: 1e3, k: 1e3, million: 1e6, mn: 1e6, mm: 1e6, m: 1e6, billion: 1e9, bn: 1e9, b: 1e9, trillion: 1e12, tn: 1e12, t: 1e12,
};

// The biggest amount in a text, skipping years and percentages; null when there is none
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

// Which facts say how big a box is, and how many staff-equivalents one unit is worth
const SIZE_FACTS: { pattern: RegExp; perStaff: number; reason: (amount: string) => string }[] = [
  { pattern: /population|residents|inhabitants|citizens|people served/i, perStaff: 50, reason: (n) => `Serves about ${n} people` },
  { pattern: /members|membership/i, perStaff: 10, reason: (n) => `About ${n} members` },
  { pattern: /employ|staff|headcount|workforce|personnel/i, perStaff: 1, reason: (n) => `About ${n} employees` },
  { pattern: /revenue|sales|turnover/i, perStaff: 250_000, reason: (n) => `Revenue about ${n}` },
  { pattern: /budget|spending|expenditure/i, perStaff: 150_000, reason: (n) => `Budget about ${n}` },
  { pattern: /valuation|market cap/i, perStaff: 1_000_000, reason: (n) => `Valued at about ${n}` },
  { pattern: /assets|under management|\baum\b/i, perStaff: 2_000_000, reason: (n) => `Assets about ${n}` },
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

// ---------------------------------------------------------------------
// DEFAULT SIZES when no fact gives a number
// ---------------------------------------------------------------------

type GovernmentLevel = "federal" | "province" | "city" | null;
const governmentLevel = (text: string): GovernmentLevel =>
  /\b(federal|national|country)\b/.test(text) ? "federal"
    : /\b(province|provincial|state|territory|territorial)\b/.test(text) ? "province"
      : /\b(city|municipal|municipality|town|county|village|regional district)\b/.test(text) ? "city" : null;
const LEVEL_WORD: Record<Exclude<GovernmentLevel, null>, string> = { federal: "a national", province: "a provincial or state", city: "a city" };

type Base = { size: number; power: number; reason: string; estimated: boolean; authority: string | null };

function defaultSize(text: string): { size: number; reason: string } {
  const level = governmentLevel(text);
  const regulator = /regulat|watchdog|ombuds/.test(text);
  const agency = /\b(agency|department|ministry|bureau|office|commission|authority|board|service)\b/.test(text);
  const government = /\b(government|govt|public body|crown)\b/.test(text) || level !== null;
  if (regulator) return { size: level === "federal" ? 2000 : level === "city" ? 100 : 500, reason: `No size found; estimated as ${level ? `${LEVEL_WORD[level]} ` : "a "}regulator` };
  if (government && agency) return { size: level === "federal" ? 5000 : level === "city" ? 200 : 1000, reason: `No size found; estimated as ${level ? `${LEVEL_WORD[level]} ` : "a "}government agency` };
  if (government) return { size: level === "federal" ? 200_000 : level === "city" ? 3000 : 30_000, reason: `No size found; estimated as ${level ? `${LEVEL_WORD[level]} ` : "a "}government` };
  if (/startup|start-up|small business|shop|consultancy|freelance/.test(text)) return { size: 20, reason: "No size found; estimated as a small business" };
  if (/universit|hospital|health authority|school district|school board/.test(text)) return { size: 3000, reason: "No size found; estimated as a large public institution" };
  if (/compan|corporat|business|firm|enterprise|inc\b|ltd\b|llc\b/.test(text)) return { size: 200, reason: "No size found; estimated as a company" };
  if (/team|department|division|unit|group|office|branch/.test(text)) return { size: 30, reason: "No size found; estimated as a team" };
  if (/nonprofit|non-profit|charity|association|union|society|foundation|organi[sz]ation|ngo/.test(text)) return { size: 50, reason: "No size found; estimated as an organization" };
  return { size: 50, reason: "No size found; estimated" };
}

function baseOf(card: StakeholderCard | undefined): Base {
  const text = card ? `${cardKind(card)} ${card.type} ${card.name}`.toLowerCase() : "";
  const authority = /regulat|watchdog|ombuds/.test(text) ? "Regulator with legal authority" : null;
  const bonus = authority ? REGULATOR_BONUS : 1;
  const found = card ? sizeFromFacts([...card.keyFacts, ...(card.web?.facts ?? [])]) : null;
  if (found) return { size: found.size, power: found.size * bonus, reason: found.reason, estimated: false, authority };
  const guess = defaultSize(text);
  return { size: guess.size, power: guess.size * bonus, reason: guess.reason, estimated: true, authority };
}

// ---------------------------------------------------------------------
// SENIORITY from a job title, when it is obvious
// ---------------------------------------------------------------------

const TITLE_SENIORITY: [RegExp, Seniority][] = [
  [/\b(owner|co-?owner|partner|proprietor)\b/, "owner"],
  [/\b(deputy minister|city manager|chief administrative officer|cao|commissioner)\b/, "top_official"],
  [/\b(mayor|premier|prime minister|minister|governor|reeve)\b/, "elected_leader"],
  [/\b(board|chair|chairman|chairwoman|chairperson|trustee|director of the board)\b/, "board"],
  [/\b(councill?or|alderman|mla|mpp|mp|senator|member of parliament|legislator|representative)\b/, "elected_member"],
  [/\b(vice president|vice-president|vp|svp|evp|avp)\b/, "vice_president"],
  [/\b(ceo|cfo|coo|cto|cio|chief|president|founder|executive director|managing director|general manager)\b/, "executive"],
  [/\b(director|head of|superintendent)\b/, "director"],
  [/\b(manager)\b/, "manager"],
  [/\b(lead|supervisor|foreman|team leader)\b/, "lead"],
  [/\b(intern|trainee|junior|apprentice|student)\b/, "entry"],
  [/\b(consultant|advisor|adviser|contractor)\b/, "advisor"],
  [/\b(engineer|analyst|officer|inspector|clerk|specialist|coordinator|associate|assistant|technician|staff|planner)\b/, "staff"],
];

export function seniorityFromTitle(title: string | null | undefined): Seniority | null {
  const text = (title ?? "").toLowerCase();
  if (!text.trim()) return null;
  return TITLE_SENIORITY.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

// ---------------------------------------------------------------------
// LEVELS: < 10 is 1, 10 to 100 is 2, 100 to 1,000 is 3, 1,000 to 10,000 is 4, more is 5
// ---------------------------------------------------------------------

export function levelOf(score: number): PowerLevel {
  return Math.min(5, Math.max(1, Math.floor(score) + 1)) as PowerLevel;
}

// ---------------------------------------------------------------------
// THE GRAPH
// ---------------------------------------------------------------------

type Seat = { boxId: string; link: "leads" | "board_member_of" | "works_in"; weight: number; guessed: boolean; title: string | null };
type Node = {
  id: string; name: string; person: boolean; base: Base;
  partOf: string[]; // parent boxes
  owns: { id: string; share: number; stated: boolean }[]; // what this node owns
  mainOwnerOf: string[]; // boxes this node is the main owner of (no cycles)
  seats: Seat[]; reportsTo: string[];
};

const SEAT_LINKS = new Set(["leads", "board_member_of", "works_in"]);
const PERSON_TYPES = /^(person|people|individual|role)$/;

function buildGraph(cards: StakeholderCard[], relations: StructureRelation[]) {
  const cardById = new Map(cards.map((card) => [card.entityId, card]));
  const live = relations.filter((relation) => relation.current !== false && relation.fromId !== relation.toId);
  const ids = [...new Set([...cards.map((card) => card.entityId), ...live.flatMap((relation) => [relation.fromId, relation.toId])])].sort();
  const personIds = new Set(ids.filter((id) => {
    const card = cardById.get(id);
    return (card && (PERSON_TYPES.test(card.type.trim().toLowerCase()) || card.person !== null))
      || live.some((relation) => (relation.fromId === id && (SEAT_LINKS.has(relation.link) || relation.link === "reports_to")) || (relation.toId === id && relation.link === "reports_to"));
  }));
  const nodes = new Map<string, Node>(ids.map((id) => [id, {
    id, name: cardById.get(id)?.name ?? "another stakeholder", person: personIds.has(id), base: baseOf(cardById.get(id)),
    partOf: [], owns: [], mainOwnerOf: [], seats: [], reportsTo: [],
  }]));
  const isBox = (id: string) => !personIds.has(id);

  const owners = new Map<string, { ownerId: string; share: number }[]>();
  for (const relation of live) {
    const from = nodes.get(relation.fromId)!;
    if (relation.link === "part_of" && isBox(relation.fromId) && isBox(relation.toId)) from.partOf.push(relation.toId);
    if (relation.link === "owned_by" && isBox(relation.fromId)) {
      const share = relation.share !== null && relation.share > 0 ? Math.min(1, relation.share) : UNKNOWN_OWNER_SHARE;
      nodes.get(relation.toId)!.owns.push({ id: relation.fromId, share, stated: relation.share !== null && relation.share > 0 });
      owners.set(relation.fromId, [...(owners.get(relation.fromId) ?? []), { ownerId: relation.toId, share }]);
    }
    if (SEAT_LINKS.has(relation.link) && from.person && isBox(relation.toId)) {
      const link = relation.link as Seat["link"];
      const fromTitle = seniorityFromTitle(relation.title);
      const seniority: Seniority = relation.seniority ?? (link === "leads" ? "executive" : link === "board_member_of" ? "board" : fromTitle ?? "staff");
      const weight = link === "leads" ? Math.max(SENIORITY_WEIGHT[seniority], SENIORITY_WEIGHT.executive) : SENIORITY_WEIGHT[seniority];
      from.seats.push({ boxId: relation.toId, link, weight, guessed: link === "works_in" && !relation.seniority && !fromTitle, title: relation.title });
    }
    if (relation.link === "reports_to" && from.person && personIds.has(relation.toId)) from.reportsTo.push(relation.toId);
  }

  // A person only known through their card's organization works in it
  for (const card of cards) {
    const node = nodes.get(card.entityId);
    const orgId = card.person?.organizationEntityId;
    if (!node?.person || !orgId || !nodes.has(orgId) || !isBox(orgId) || node.seats.some((seat) => seat.boxId === orgId)) continue;
    const seniority = seniorityFromTitle(card.person?.title);
    node.seats.push({ boxId: orgId, link: "works_in", weight: SENIORITY_WEIGHT[seniority ?? "staff"], guessed: !seniority, title: card.person?.title ?? null });
  }

  // Main owner of each box: the biggest share. Ownership cycles are cut so the main-owner chain is a tree.
  const mainOwner = new Map<string, string>();
  for (const [boxId, list] of owners) {
    const best = [...list].sort((a, b) => b.share - a.share || a.ownerId.localeCompare(b.ownerId))[0]!;
    mainOwner.set(boxId, best.ownerId);
  }
  const settled = new Set<string>();
  for (const start of ids) {
    const path: string[] = [];
    let at: string | undefined = start;
    while (at !== undefined && !settled.has(at)) {
      if (path.includes(at)) { mainOwner.delete(path[path.length - 1]!); break; }
      path.push(at);
      at = mainOwner.get(at);
    }
    for (const id of path) settled.add(id);
  }
  for (const [boxId, ownerId] of mainOwner) nodes.get(ownerId)!.mainOwnerOf.push(boxId);
  return nodes;
}

// ---------------------------------------------------------------------
// ONE STEP: a node's power from everyone's power in the step before
// ---------------------------------------------------------------------

type Part = { amount: number; reason: string; estimated: boolean };
type State = { power: Map<string, number>; estimated: Map<string, boolean> };

// "at Company A": the box a seat's box sits in, for the reason sentence
const placeOf = (nodes: Map<string, Node>, box: Node) => {
  const parentId = box.partOf[0];
  return parentId ? ` at ${nodes.get(parentId)!.name}` : "";
};

function seatReason(nodes: Map<string, Node>, seat: Seat): string {
  const box = nodes.get(seat.boxId)!;
  if (seat.link === "leads") return `Leads ${box.name}${placeOf(nodes, box)}`;
  if (seat.link === "board_member_of") return `Board member of ${box.name}`;
  return seat.title ? `${seat.title.charAt(0).toUpperCase()}${seat.title.slice(1)} at ${box.name}` : `Works in ${box.name}`;
}

function step(nodes: Map<string, Node>, node: Node, before: State): Part[] {
  const power = (id: string) => before.power.get(id)!;
  const guessed = (id: string) => before.estimated.get(id)!;
  const parts: Part[] = [];

  if (node.person) {
    const seats = node.seats.map((seat) => ({ amount: power(seat.boxId) * seat.weight, reason: seatReason(nodes, seat), estimated: guessed(seat.boxId) || seat.guessed }))
      .sort((a, b) => b.amount - a.amount);
    seats.forEach((seat, index) => parts.push(index === 0 ? seat : { ...seat, amount: seat.amount * OTHER_SEAT_SHARE }));
    if (!seats.length && node.reportsTo.length) {
      const boss = [...node.reportsTo].sort((a, b) => power(b) - power(a))[0]!;
      parts.push({ amount: power(boss) * REPORTS_TO_SHARE, reason: `Reports to ${nodes.get(boss)!.name}`, estimated: true });
    }
    if (!parts.length) parts.push({ amount: PERSON_FLOOR, reason: "No known role or seat yet", estimated: true });
  } else if (node.partOf.length) {
    const fromParents = node.partOf.map((parentId): Part => {
      const parent = nodes.get(parentId)!;
      const reason = `Part of ${parent.name}`;
      if (!node.base.estimated && !parent.base.estimated) {
        const ratio = Math.min(MAX_CHILD_SHARE, Math.max(0.001, node.base.size / parent.base.size));
        return { amount: power(parentId) * ratio, reason, estimated: guessed(parentId) };
      }
      if (!node.base.estimated) return { amount: Math.min(node.base.power, power(parentId) * MAX_CHILD_SHARE), reason, estimated: false };
      return { amount: power(parentId) * DEFAULT_CHILD_SHARE, reason, estimated: true };
    }).sort((a, b) => b.amount - a.amount);
    fromParents.forEach((part, index) => parts.push(index === 0 ? part : { ...part, amount: part.amount * EXTRA_PARENT_SHARE }));
    if (!node.base.estimated) parts.push({ amount: 0, reason: node.base.reason, estimated: false });
  } else {
    parts.push({ amount: node.base.size, reason: node.base.reason, estimated: node.base.estimated });
    if (node.base.authority) parts.push({ amount: node.base.power - node.base.size, reason: node.base.authority, estimated: node.base.estimated });
  }

  for (const owned of node.owns) {
    const name = nodes.get(owned.id)!.name;
    parts.push({
      amount: owned.share * power(owned.id) * OWNER_DAMPING,
      reason: owned.stated ? `Owns ${Math.round(owned.share * 100)} percent of ${name}` : `Owns ${name}`,
      estimated: guessed(owned.id),
    });
  }
  // The main owner ranks above what it owns: top up the "Owns" part
  for (const ownedId of node.mainOwnerOf) {
    const total = parts.reduce((sum, part) => sum + part.amount, 0);
    const floor = power(ownedId) * OWNER_ABOVE;
    if (total >= floor) continue;
    const name = nodes.get(ownedId)!.name;
    const ownsPart = parts.find((part) => part.reason.startsWith("Owns ") && part.reason.endsWith(name));
    if (ownsPart) ownsPart.amount += floor - total;
  }
  return parts;
}

const total = (parts: Part[]) => parts.reduce((sum, part) => sum + part.amount, 0);
// The biggest part decides whether the whole is an estimate
const biggestEstimated = (parts: Part[]) => [...parts].sort((a, b) => b.amount - a.amount)[0]?.estimated ?? true;

function settle(nodes: Map<string, Node>): { state: State; parts: Map<string, Part[]> } {
  let state: State = {
    power: new Map([...nodes.values()].map((node) => [node.id, node.person ? PERSON_FLOOR : node.base.power])),
    estimated: new Map([...nodes.values()].map((node) => [node.id, true])),
  };
  let parts = new Map<string, Part[]>();
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    parts = new Map([...nodes.values()].map((node) => [node.id, step(nodes, node, state)]));
    const next: State = {
      power: new Map([...parts].map(([id, list]) => [id, Math.max(total(list), 1e-6)])),
      estimated: new Map([...parts].map(([id, list]) => [id, biggestEstimated(list)])),
    };
    const moved = [...next.power].some(([id, value]) => Math.abs(value - state.power.get(id)!) > 1e-9 * Math.max(1, value));
    state = next;
    if (!moved) break;
  }
  return { state, parts };
}

function resultOf(power: number, parts: Part[], estimated: boolean): PowerResult {
  const score = Math.round(Math.log10(power) * 100) / 100;
  const merged = new Map<string, number>();
  for (const part of parts) merged.set(part.reason, (merged.get(part.reason) ?? 0) + part.amount);
  const reasons = [...merged].sort((a, b) => b[1] - a[1]).map(([reason]) => reason).slice(0, MAX_REASONS);
  return { score, level: levelOf(score), reasons, estimated };
}

// General power of every stakeholder in the cards and relations, keyed by entity id
export function computePower(cards: StakeholderCard[], relations: StructureRelation[]): Map<string, PowerResult> {
  const nodes = buildGraph(cards, relations);
  const { state, parts } = settle(nodes);
  return new Map([...nodes.keys()].map((id) => [id, resultOf(state.power.get(id)!, parts.get(id)!, state.estimated.get(id)!)]));
}
