import type { StakeholderCard } from "@/lib/stakeholders/cards";
import { INSIDE_LINKS, SENIORITIES, STRUCTURE_LINKS, type Seniority, type StructureLinkType, type StructureRelation } from "@/lib/stakeholders/structure";

// =====================================================================
// STRUCTURE TREE (pure): turns the cards and their structure links into
// nested boxes. Organizations are boxes; people are rows inside them.
// Inside links nest (part of, owned by, leads, board, works in, reports
// to); pressure links (regulates, funds, contracts with) only add a line.
// Each organization sits in one parent box, so the map stays a tree.
// Former people (a seat that ended) are kept apart, after the current ones.
// =====================================================================

export type PressureLine = { link: StructureLinkType; label: string; targetId: string; targetName: string };
export type MemberRole = "owner" | "leader" | "board" | "member";
export type StructureMember = {
  entityId: string; name: string; role: MemberRole; title: string | null; seniority: Seniority | null;
  since: string | null; until: string | null; asOf: string | null;
  reportsTo: string[]; pressure: PressureLine[];
};
export type StructureBox = {
  entityId: string; name: string;
  leaders: StructureMember[]; people: StructureMember[]; former: StructureMember[];
  boxes: StructureBox[]; pressure: PressureLine[];
};
export type Structure = { boxes: StructureBox[]; loose: { entityId: string; name: string }[] };

type Card = Pick<StakeholderCard, "entityId" | "name" | "type" | "person">;
type Seat = Pick<StructureRelation, "title" | "seniority" | "since" | "until" | "asOf">;

// Which parent an organization nests in when it has several: the first link in this order
const NESTING_ORDER: StructureLinkType[] = ["part_of", "owned_by", "leads", "board_member_of", "works_in"];
const ROLE_ORDER: MemberRole[] = ["owner", "leader", "board", "member"];
const LINK_LABELS = new Map(STRUCTURE_LINKS.map((entry) => [entry.link, entry.label]));
const NO_SEAT: Seat = { title: null, seniority: null, since: null, until: null, asOf: null };

export const isPerson = (card: Card) => card.type.trim().toLowerCase() === "person" || card.person !== null;

const yearOf = (date: string | null) => date?.slice(0, 4) ?? null;

// "2016 to 2021", "from 2016", "until 2021", or null when neither end is known
export function yearsText(since: string | null, until: string | null): string | null {
  const [from, to] = [yearOf(since), yearOf(until)];
  if (from && to) return from === to ? from : `${from} to ${to}`;
  return from ? `from ${from}` : to ? `until ${to}` : null;
}

// The year a current link was last confirmed, when that is before last year; else null
export function staleYear(asOf: string | null, now: Date = new Date()): string | null {
  const year = yearOf(asOf);
  return year && Number(year) < now.getFullYear() - 1 ? year : null;
}

// rank: a bigger number sorts first (the page passes the power score); ties go by name
export function buildStructure(cards: Card[], relations: StructureRelation[], rank: (entityId: string) => number = () => 0): Structure {
  const byId = new Map(cards.map((card) => [card.entityId, card]));
  const known = relations
    .filter((relation) => relation.fromId !== relation.toId && byId.has(relation.fromId) && byId.has(relation.toId))
    .sort((a, b) => a.fromId.localeCompare(b.fromId) || a.link.localeCompare(b.link) || a.toId.localeCompare(b.toId));
  const live = known.filter((relation) => relation.current);
  const person = (id: string) => isPerson(byId.get(id)!);
  const name = (id: string) => byId.get(id)!.name;

  // 1. Each organization's one parent: the first current link by NESTING_ORDER that makes no loop
  const parent = new Map<string, string>();
  const loops = (child: string, candidate: string) => {
    for (let at: string | undefined = candidate; at; at = parent.get(at)) if (at === child) return true;
    return false;
  };
  for (const link of NESTING_ORDER) {
    for (const relation of live) {
      if (relation.link !== link || person(relation.fromId) || person(relation.toId) || parent.has(relation.fromId)) continue;
      if (!loops(relation.fromId, relation.toId)) parent.set(relation.fromId, relation.toId);
    }
  }

  // 2. People's rows, one per (box, person), keeping the strongest role; former seats apart
  const rows = new Map<string, Map<string, StructureMember>>();
  const formerRows = new Map<string, Map<string, StructureMember>>();
  const addRow = (into: typeof rows, boxId: string, personId: string, role: MemberRole, seat: Seat) => {
    const box = into.get(boxId) ?? new Map<string, StructureMember>();
    into.set(boxId, box);
    const existing = box.get(personId);
    if (existing && ROLE_ORDER.indexOf(existing.role) <= ROLE_ORDER.indexOf(role)) {
      existing.title ??= seat.title;
      existing.seniority ??= seat.seniority;
      return;
    }
    box.set(personId, {
      entityId: personId, name: name(personId), role,
      title: seat.title ?? existing?.title ?? null, seniority: seat.seniority ?? existing?.seniority ?? null,
      since: seat.since, until: seat.until, asOf: seat.asOf, reportsTo: [], pressure: [],
    });
  };
  for (const relation of known) {
    const { fromId, toId, link, seniority } = relation;
    const into = relation.current ? rows : formerRows;
    if (link === "owned_by" && person(toId) && !person(fromId)) addRow(into, fromId, toId, "owner", { ...relation, seniority: seniority ?? "owner" });
    else if (!person(fromId) || person(toId)) continue;
    else if (link === "leads") addRow(into, toId, fromId, "leader", relation);
    else if (link === "board_member_of") addRow(into, toId, fromId, "board", { ...relation, seniority: seniority ?? "board" });
    else if (link === "works_in") addRow(into, toId, fromId, "member", relation);
  }
  // A person who still holds a seat in a box is not also listed as former there
  for (const [boxId, box] of formerRows) for (const personId of [...box.keys()]) if (rows.get(boxId)?.has(personId)) box.delete(personId);

  // 3. Reports to: a person with no box of their own joins their boss's first box
  const placed = new Set([...rows.values()].flatMap((box) => [...box.keys()]));
  const reports = live.filter((relation) => relation.link === "reports_to" && person(relation.fromId) && person(relation.toId));
  for (const { fromId, toId } of reports) {
    if (placed.has(fromId)) continue;
    const bossBox = [...rows].filter(([, box]) => box.has(toId)).map(([boxId]) => boxId).sort()[0];
    if (bossBox) { addRow(rows, bossBox, fromId, "member", NO_SEAT); placed.add(fromId); }
  }
  for (const box of rows.values()) {
    for (const { fromId, toId } of reports) {
      const row = box.get(fromId);
      if (row && !row.reportsTo.includes(name(toId))) row.reportsTo.push(name(toId));
    }
  }

  // 4. Pressure lines (current only) go on the box or row of the side that presses
  const pressure = new Map<string, PressureLine[]>();
  for (const relation of live) {
    if (INSIDE_LINKS.has(relation.link)) continue;
    const lines = pressure.get(relation.fromId) ?? [];
    pressure.set(relation.fromId, lines);
    lines.push({ link: relation.link, label: LINK_LABELS.get(relation.link) ?? relation.link, targetId: relation.toId, targetName: name(relation.toId) });
  }
  for (const box of rows.values()) for (const row of box.values()) row.pressure = pressure.get(row.entityId) ?? [];

  // 5. Assemble from the top: organizations with no parent; empty ones are listed as loose
  const order = (a: { entityId: string; name: string }, b: { entityId: string; name: string }) =>
    rank(b.entityId) - rank(a.entityId) || a.name.localeCompare(b.name);
  const seniorityRank = (seniority: Seniority | null) => (seniority ? SENIORITIES.indexOf(seniority) : SENIORITIES.length);
  const memberOrder = (a: StructureMember, b: StructureMember) =>
    ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || seniorityRank(a.seniority) - seniorityRank(b.seniority) || order(a, b);
  const children = new Map<string, string[]>();
  for (const [child, of] of parent) children.set(of, [...(children.get(of) ?? []), child]);
  const build = (id: string): StructureBox => {
    const members = [...(rows.get(id)?.values() ?? [])].sort(memberOrder);
    return {
      entityId: id, name: name(id),
      leaders: members.filter((member) => member.role !== "member"),
      people: members.filter((member) => member.role === "member"),
      former: [...(formerRows.get(id)?.values() ?? [])].sort(memberOrder),
      boxes: (children.get(id) ?? []).map(build).sort(order),
      pressure: pressure.get(id) ?? [],
    };
  };
  const tops = cards.filter((card) => !isPerson(card) && !parent.has(card.entityId)).map((card) => build(card.entityId));
  const filled = (box: StructureBox) => box.leaders.length + box.people.length + box.former.length + box.boxes.length + box.pressure.length > 0;
  const formerOnly = new Set([...formerRows.values()].flatMap((box) => [...box.keys()]));
  return {
    boxes: tops.filter(filled).sort(order),
    loose: [...tops.filter((box) => !filled(box)), ...cards.filter((card) => isPerson(card) && !placed.has(card.entityId) && !formerOnly.has(card.entityId))]
      .map(({ entityId, name: looseName }) => ({ entityId, name: looseName })).sort(order),
  };
}
