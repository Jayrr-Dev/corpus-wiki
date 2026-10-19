import { AI_FLOW_LANES, CHANGE_CONTROL, PERSON_STEPS } from "./aiFlowModel";
import { STEP_ICONS } from "./roleIcons";
import type { CanvasDiagram, CanvasEdge, CanvasGroup, CanvasNode } from "./canvasTypes";

// AI FLOW CANVAS: the AI roles placed left to right. The canvas shows a short label only; the
// facts in aiFlowModel fill the details panel.
export const CANVAS = { width: 4900, height: 1700, busX: 40, busEnd: 4220, busY: 600, busH: 90, mainY: 330, lowerY: 1000 };

const lanes = Object.fromEntries(AI_FLOW_LANES.flatMap((lane) => lane.nodes).map((node) => [node.id, node]));
function placed(id: string, x: number, y: number, extra: Partial<CanvasNode> & { short: string }): CanvasNode {
  const node = lanes[id]!;
  const variant = node.kind === "unnamed" ? "unnamed" : node.kind === "reviewer" ? "independent" : undefined;
  return {
    id, shape: node.kind === "system" ? "box" : "circle", x, y, title: node.name, variant, roleId: node.roleId, roles: node.roles,
    facts: node.facts, instructionsNote: node.instructionsNote, actions: node.submits, exceptions: node.exceptions, ...extra,
  };
}
const M = CANVAS.mainY, L = CANVAS.lowerY;

export const CANVAS_NODES: CanvasNode[] = [
  placed("sourcer", 1800, 1460, { short: "User-preapproved sources and new knowledge" }),
  placed("composer", 600, 1460, { short: "Selects and reviews article images" }),
  placed("asset-lifecycle", 1000, 1460, { short: "Usage, Unlink and seven-day cleanup" }),
  { id: "upload", shape: "pill", variant: "person", x: 120, y: M, title: "You upload a file", facts: [{ label: "Starts", text: "An upload runs groups 1 to 3 in order: save the evidence, clean and file it, then write and review the first articles. Background enrichment and a conditional article refresh follow; glossary and Curator finish the run." }] },
  placed("media", 370, M, { short: "Reads images and video" }),
  placed("reconciler", 620, M, { short: "Turns passages into claims", sends: "claims, links, entities", needsYou: true }),
  placed("embeddings", 900, M, { title: "Indexing", short: "Indexes claims by meaning", store: "vectors" }),
  placed("deduplicator", 1150, M, { short: "Merges repeated claims", sends: "merges", needsYou: true }),
  placed("tidy", 1400, M, { short: "Merges and retires entities", sends: "entity merges" }),
  placed("place", 1650, M, { short: "Files claims into topics", sends: "topics", needsYou: true }),
  placed("describe", 3150, M, { short: "Describes new entities", store: "entities" }),
  placed("profiles", 3400, M, { short: "Builds stakeholder cards", store: "cards" }),
  placed("hierarchy", 1900, M, { title: "Hierarchy", short: "Orders topic contexts" }),
  placed("dictionary", 3930, M, { short: "Writes the glossary", store: "glossary" }),
  placed("definer", 3650, M, { short: "Defines key terms", sends: "terms" }),
  placed("planner", 2150, M, { short: "Proposes articles", sends: "outlines" }),
  placed("article_reviewer", 2400, M, { short: "Approves new articles", sends: "new pages" }),
  placed("writer", 2650, M, { short: "Writes the sections", sends: "lines", needsYou: true }),
  placed("reviewer", 2900, M, { short: "Polishes rebuilt pages", sends: "page edits", needsYou: true }),

  { id: "vectors", shape: "cylinder", variant: "store", x: 900, y: 165, title: "Vectors", facts: [{ label: "Saved here", text: "Claim vectors, written directly. Later roles use them to find related knowledge." }] },
  { id: "entities", shape: "cylinder", variant: "store", x: 3150, y: 165, title: "Entities", facts: [{ label: "Saved here", text: "Entity descriptions, written directly on each entity." }] },
  { id: "cards", shape: "cylinder", variant: "store", x: 3400, y: 165, title: "Cards", facts: [{ label: "Saved here", text: "Stakeholder cards and web profiles, written directly with no approval. Your contacts and hidden cards are never overwritten." }] },
  { id: "glossary", shape: "cylinder", variant: "store", x: 3930, y: 165, title: "Glossary", facts: [{ label: "Saved here", text: "Cited glossary entries, written directly." }] },

  placed("domain_decider", 1400, L, { short: "Updates domains from clusters", sends: "domain update", needsYou: true }),
  placed("domain_steward", 500, L, { short: "Reviews the topic tree", sends: "topic change", needsYou: true }),
  placed("linker", 800, L, { short: "Links related claims", sends: "links" }),
  placed("curator", 1100, L, { short: "Keeps the page tree clean", sends: "page changes", needsYou: true }),

  { id: "start-section", shape: "pill", variant: "person", x: 2420, y: L, title: "You build a section", facts: [{ label: "Starts", text: "Creating, improving or force-creating a section, or saving a stakeholder’s web page. Only when outside knowledge is allowed in Settings. Never during an upload." }] },
  placed("researcher-search", 2650, L, { short: "Proposes a research gap" }),
  placed("reviewer-search", 2900, L, { short: "Approves the search", sends: "decision record" }),
  { id: "web-search", shape: "box", x: 3150, y: L, title: "Web search", short: "Finds candidate pages", facts: [{ label: "Does", text: "Searches with the approved query and fetches page text. Finding a page does not admit it." }] },
  placed("researcher-source", 3400, L, { short: "Picks exact excerpts" }),
  placed("reviewer-source", 3650, L, { short: "Approves the excerpts", sends: "decision record" }),
  placed("reconciler-external", 3900, L, { short: "Adds approved claims", sends: "claims" }),
  { id: "stop", shape: "box", variant: "stop", x: 3275, y: 1195, title: "Stopped", facts: [{ label: "What happens", text: "A rejected search or source adds nothing. The decision and its reason are recorded." }] },

  { id: "change-control", shape: "bus", x: (CANVAS.busX + CANVAS.busEnd) / 2, y: CANVAS.busY + CANVAS.busH / 2, title: CHANGE_CONTROL.name, short: "Every change is checked here", facts: CHANGE_CONTROL.facts },
  { id: "knowledge", shape: "cylinder", variant: "store", x: 4450, y: 420, title: "Knowledge & pages", facts: [{ label: "Saved here", text: "Claims, entities, topics, links and article pages. Everything here arrives through Change control, so it can be undone in Changes." }] },
  { id: "exceptions", shape: "diamond", variant: "person", x: 4450, y: 860, title: "Exceptions", short: "You approve or reject", facts: PERSON_STEPS[0]!.facts, exceptions: PERSON_STEPS[0]!.chips },
  { id: "changes", shape: "diamond", variant: "person", x: 4720, y: 420, title: "Changes", short: "You can undo", facts: PERSON_STEPS[1]!.facts },
];

const B = CANVAS.busY, BB = CANVAS.busY + CANVAS.busH;
const HANDOFFS: [string, string, string?][] = [
  ["upload", "media", "file"], ["media", "reconciler", "passages"], ["reconciler", "embeddings", "saved claims"], ["embeddings", "deduplicator"], ["deduplicator", "tidy"], ["tidy", "place"], ["place", "hierarchy"], ["hierarchy", "planner", "filed claims"], ["planner", "article_reviewer", "proposals"], ["article_reviewer", "writer", "verdicts"], ["writer", "reviewer", "sections"], ["reviewer", "describe", "articles ready"], ["describe", "profiles"], ["profiles", "definer"], ["definer", "dictionary", "after article refresh"],
  ["start-section", "researcher-search", "context"], ["researcher-search", "reviewer-search", "proposal"], ["reviewer-search", "web-search", "yes"], ["web-search", "researcher-source", "pages"], ["researcher-source", "reviewer-source", "excerpts"], ["reviewer-source", "reconciler-external", "yes"],
];
export const CANVAS_EDGES: CanvasEdge[] = [
  { from: "composer", to: "asset-lifecycle", kind: "handoff", label: "reusable images" },
  ...HANDOFFS.map(([from, to, label]) => ({ from, to, label, kind: "handoff" as const })),
  { from: "reviewer-search", to: "stop", kind: "reject", label: "no", path: "M2900 1094V1195H3198", labelAt: [2900, 1150] },
  { from: "reviewer-source", to: "stop", kind: "reject", label: "no", path: "M3650 1094V1195H3352", labelAt: [3650, 1150] },
  { from: "reconciler-external", to: "writer", kind: "return", label: "new claims → section rebuilt", path: `M3956 ${L}H4060V240H2650V272`, labelAt: [4060, 725] },
  { from: "change-control", to: "knowledge", kind: "commit", label: "applies safe changes", path: `M${CANVAS.busEnd} ${B + 30}H4300V420H4378`, labelAt: [4300, 520] },
  { from: "change-control", to: "exceptions", kind: "decide", label: "holds risky ones", path: `M${CANVAS.busEnd} ${BB - 30}H4300V860H4388`, labelAt: [4300, 770] },
  { from: "exceptions", to: "knowledge", kind: "decide", label: "you approve", path: "M4450 800V465", labelAt: [4450, 640] },
  { from: "changes", to: "knowledge", kind: "decide", label: "undo", path: "M4660 420H4522", labelAt: [4590, 400] },
];

export const CANVAS_GROUPS: CanvasGroup[] = [
  { id: "sourcer", title: "Add External Info · Sourcer", note: "Your article-menu request preapproves search and import; evidence checks and reconciliation still apply", x: 1580, y: 1300, w: 1500, h: 360 },
  { id: "illustrations", title: "Illustrations and asset lifecycle", note: "Separate from evidence admission and Change control; see the dedicated flows for each step", x: 300, y: 1300, w: 1250, h: 360 },
  { id: "save", title: "1 · Save the evidence", note: "When you upload a file", x: 20, y: 20, w: 740, h: 520 },
  { id: "clean", title: "2 · Clean and file the knowledge", note: "Right after the save, in order", x: 780, y: 20, w: 1250, h: 520 },
  { id: "articles", title: "3 · Write the articles", note: "Once the knowledge is filed", x: 2050, y: 20, w: 980, h: 520 },
  { id: "enrich", title: "4 · Background enrichment", note: "Articles ready; expanded claims trigger a separate article pass, then glossary and Curator", x: 3050, y: 20, w: 1080, h: 520 },
  { id: "request", title: "4 · On request", note: "Only when you start it", x: 300, y: 760, w: 1250, h: 400 },
  { id: "research", title: "5 · Outside research", note: "Two independent approvals", x: 2280, y: 760, w: 1840, h: 500 },
  { id: "decide", title: "You and your data", note: "Where changes land", x: 4290, y: 300, w: 560, h: 680, tone: "person" },
];

export const AI_FLOW: CanvasDiagram = {
  width: CANVAS.width, height: CANVAS.height, nodes: CANVAS_NODES.map((node) => ({ ...node, icon: STEP_ICONS[node.id] })), edges: CANVAS_EDGES, groups: CANVAS_GROUPS,
  bus: { x: CANVAS.busX, end: CANVAS.busEnd, y: CANVAS.busY, h: CANVAS.busH },
};
