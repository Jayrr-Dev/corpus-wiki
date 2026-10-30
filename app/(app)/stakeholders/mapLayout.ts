import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import { type StakeholderCard as Card, cardKind } from "@/lib/stakeholders/cards";
import { INSIDE_LINKS, STRUCTURE_LINKS, type StructureRelation } from "@/lib/stakeholders/structure";

// =====================================================================
// STAKEHOLDER MAP: who is linked to whom, as dots and lines. One line per
// pair of stakeholders, current links only. Our organization sits in the
// middle (else the most powerful stakeholder) and bigger dots hold more
// power. The layout settles once here, so the view only draws it.
// =====================================================================

export type MapGroup = "government" | "organization" | "person";
export const MAP_GROUPS: { group: MapGroup; label: string }[] = [
  { group: "government", label: "Government" }, { group: "organization", label: "Organization" }, { group: "person", label: "Person" },
];

type MapCard = Pick<Card, "entityId" | "name" | "type" | "kind" | "logoUrl" | "isOurs"> & { person: unknown };
export type MapNode = { card: MapCard; group: MapGroup; centre: boolean; r: number; x: number; y: number };
export type MapEdge = { id: string; fromId: string; toId: string; label: string; pressure: boolean; x1: number; y1: number; x2: number; y2: number };
export type StakeholderMapModel = {
  nodes: MapNode[]; edges: MapEdge[]; width: number; height: number;
  loose: { entityId: string; name: string }[]; // no current link to anyone shown
  left: number; // linked stakeholders past MAX_NODES
};

// More dots than this stop being readable; the strongest stay, and search or a filter finds the rest
export const MAX_NODES = 40;
const WIDTH = 880;
const MIN_HEIGHT = 440;
const MAX_HEIGHT = 900;
const HEIGHT_PER_NODE = 24;
const RADIUS = { centre: 30, big: 26, small: 16 };
// Room for a name under a dot, and for the name's width at the sides
const PAD_X = 64;
const PAD_Y = 40;
const SETTLE_TICKS = 300;
const GAP_TO_ARROW = 3;

const GOVERNMENT = /\b(government|agency|ministry|municipal\w*|city|county|regulator|authority|council)\b/;
const PERSON = new Set(["person", "role"]);

// Kinds are free text; the map reads them down to three colours
export function mapGroup(card: Pick<MapCard, "type" | "kind" | "person">): MapGroup {
  const kind = cardKind(card);
  if (card.person || PERSON.has(kind) || card.type.toLowerCase() === "person") return "person";
  return GOVERNMENT.test(kind) ? "government" : "organization";
}

const linkOrder = (relation: StructureRelation) => STRUCTURE_LINKS.findIndex((entry) => entry.link === relation.link);
const labelOf = (relation: StructureRelation) => STRUCTURE_LINKS[linkOrder(relation)]!.label.toLowerCase();
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// One relation per pair: a pair with several links shows the first on the STRUCTURE_LINKS list
function currentPairs(relations: readonly StructureRelation[], ids: ReadonlySet<string>): StructureRelation[] {
  const pairs = new Map<string, StructureRelation>();
  const live = relations.filter((relation) => relation.current && !relation.until && relation.fromId !== relation.toId && ids.has(relation.fromId) && ids.has(relation.toId));
  for (const relation of [...live].sort((a, b) => linkOrder(a) - linkOrder(b))) {
    const key = pairKey(relation.fromId, relation.toId);
    if (!pairs.has(key)) pairs.set(key, relation);
  }
  return [...pairs.values()];
}

type SimNode = SimulationNodeDatum & { id: string; r: number };

// Runs the forces to rest, the centre pinned, then keeps every dot inside the frame
function settle(nodes: SimNode[], links: { source: string; target: string }[], width: number, height: number) {
  const simulation = forceSimulation(nodes)
    .force("link", forceLink<SimNode, { source: string; target: string }>(links).id((node) => node.id).distance(150).strength(0.35))
    .force("charge", forceManyBody().strength(-1100))
    .force("collide", forceCollide<SimNode>((node) => node.r + 30))
    .force("x", forceX(width / 2).strength(0.06))
    .force("y", forceY(height / 2).strength(0.1))
    .stop();
  simulation.tick(SETTLE_TICKS);
  for (const node of nodes) {
    node.x = Math.min(width - PAD_X, Math.max(PAD_X, node.x ?? width / 2));
    node.y = Math.min(height - PAD_Y - node.r, Math.max(PAD_Y, node.y ?? height / 2));
  }
}

// A line stops at the rim of each dot, with room for the arrow at the far end
function edgeBetween(relation: StructureRelation, from: MapNode, to: MapNode): MapEdge {
  const distance = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const ux = (to.x - from.x) / distance;
  const uy = (to.y - from.y) / distance;
  return {
    id: `${relation.fromId}:${relation.link}:${relation.toId}`, fromId: relation.fromId, toId: relation.toId,
    label: labelOf(relation), pressure: !INSIDE_LINKS.has(relation.link),
    x1: from.x + ux * from.r, y1: from.y + uy * from.r,
    x2: to.x - ux * (to.r + GAP_TO_ARROW), y2: to.y - uy * (to.r + GAP_TO_ARROW),
  };
}

export function buildStakeholderMap(cards: readonly MapCard[], relations: readonly StructureRelation[], scoreOf: (entityId: string) => number): StakeholderMapModel {
  const pairs = currentPairs(relations, new Set(cards.map((card) => card.entityId)));
  const linked = new Set(pairs.flatMap((pair) => [pair.fromId, pair.toId]));
  const loose = cards.filter((card) => !linked.has(card.entityId)).map(({ entityId, name }) => ({ entityId, name }));
  const ranked = cards.filter((card) => linked.has(card.entityId))
    .sort((a, b) => Number(b.isOurs) - Number(a.isOurs) || scoreOf(b.entityId) - scoreOf(a.entityId) || a.name.localeCompare(b.name));
  const kept = ranked.slice(0, MAX_NODES);
  const keptIds = new Set(kept.map((card) => card.entityId));
  const keptPairs = pairs.filter((pair) => keptIds.has(pair.fromId) && keptIds.has(pair.toId));

  const height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, 180 + kept.length * HEIGHT_PER_NODE));
  const radiusAt = (rank: number) => (rank === 0 ? RADIUS.centre : RADIUS.big - (RADIUS.big - RADIUS.small) * (rank / Math.max(1, kept.length - 1)));
  const sim: SimNode[] = kept.map((card, rank) => ({ id: card.entityId, r: radiusAt(rank), ...(rank === 0 && { fx: WIDTH / 2, fy: height / 2 }) }));
  settle(sim, keptPairs.map((pair) => ({ source: pair.fromId, target: pair.toId })), WIDTH, height);

  const nodes = kept.map((card, rank): MapNode => ({ card, group: mapGroup(card), centre: rank === 0, r: sim[rank]!.r, x: sim[rank]!.x!, y: sim[rank]!.y! }));
  const byId = new Map(nodes.map((node) => [node.card.entityId, node]));
  const edges = keptPairs.map((pair) => edgeBetween(pair, byId.get(pair.fromId)!, byId.get(pair.toId)!));
  return { nodes, edges, width: WIDTH, height, loose, left: ranked.length - kept.length };
}
