import type { LucideIcon } from "lucide-react";
import { Globe, ListTree, ShieldCheck } from "lucide-react";
import { KNOWLEDGE_FLOW, RESEARCH_FLOW, type Flow } from "./flowModel";
import type { CanvasDiagram, CanvasNode } from "./canvasTypes";
import { ROLE_ICONS } from "./roleIcons";

// FLOWS CANVAS: the Knowledge pipeline and Outside research flows laid out left to right in the
// same shapes as the AI flow. Shapes carry a short title; the step's text from flowModel fills
// the details panel. An AI circle shows its role name under it.
type Place = { shape: CanvasNode["shape"]; x: number; y: number; title: string; short?: string; variant?: CanvasNode["variant"]; icon?: LucideIcon; roles?: string[]; instructionsNote?: string };

function nodesFrom(flow: Flow, places: Record<string, Place>): CanvasNode[] {
  return flow.nodes.map((node) => {
    const place = places[node.id]!;
    const roles = place.roles ?? node.roles;
    return {
      id: node.id, ...place, roles,
      icon: place.icon ?? (roles?.length === 1 ? ROLE_ICONS[roles[0]!] : undefined),
      facts: [{ label: node.label, text: node.detail }, { label: "In short", text: node.description }],
    };
  });
}

const Y = 320;
export const KNOWLEDGE_CANVAS: CanvasDiagram = {
  width: 2900, height: 760,
  nodes: nodesFrom(KNOWLEDGE_FLOW, {
    source: { shape: "pill", variant: "person", x: 120, y: Y, title: "Your sources" },
    // The shared draft is guided by five stage skills (lib/ai/tokenFactory/prompt.ts)
    reconcile: { shape: "circle", x: 380, y: Y, title: "Reconcile", short: "Reconciler", icon: ROLE_ICONS.reconciler, roles: ["extract_knowledge", "identify_entities", "link_knowledge", "organize_topics", "define_concepts"] },
    checks: { shape: "box", x: 640, y: Y, title: "Check changes", short: "Change control", icon: ShieldCheck },
    knowledge: { shape: "cylinder", variant: "store", x: 900, y: Y, title: "Saved knowledge" },
    decision: { shape: "diamond", variant: "person", x: 640, y: 580, title: "Your review", short: "In Exceptions" },
    entities: { shape: "circle", x: 1160, y: Y, title: "Describe entities", short: "Entity analyst" },
    define: { shape: "circle", x: 1420, y: Y, title: "Define concepts", short: "Definer" },
    plan: { shape: "circle", x: 1680, y: Y, title: "Plan the article", short: "Planner" },
    write: { shape: "circle", x: 1940, y: Y, title: "Write sections", short: "Writer" },
    article: { shape: "cylinder", variant: "store", x: 2200, y: Y, title: "Living articles" },
    hierarchy: { shape: "box", x: 2460, y: Y, title: "Hierarchy", short: "Keeps contexts in order", icon: ListTree },
    dedupe: { shape: "circle", x: 2720, y: Y, title: "Clean up repeats", short: "Duplicate reviewer", icon: ROLE_ICONS.deduplicator, instructionsNote: "The Duplicate reviewer uses instructions managed by the app; they cannot be edited in Agent Roles." },
  }),
  edges: [
    { from: "source", to: "reconcile", kind: "handoff", label: "files" },
    { from: "reconcile", to: "checks", kind: "handoff", label: "proposed changes" },
    { from: "checks", to: "knowledge", kind: "handoff", label: "safe changes" },
    { from: "checks", to: "decision", kind: "decide", label: "needs you", path: "M600 394V560", labelAt: [600, 470] },
    { from: "decision", to: "checks", kind: "decide", label: "decided", path: "M680 560V396", labelAt: [680, 430] },
    { from: "knowledge", to: "entities", kind: "handoff" },
    { from: "entities", to: "define", kind: "handoff" },
    { from: "define", to: "plan", kind: "handoff", label: "terms" },
    { from: "plan", to: "write", kind: "handoff", label: "outline" },
    { from: "write", to: "article", kind: "handoff", label: "sections" },
    { from: "article", to: "hierarchy", kind: "handoff", label: "then maintain" },
    { from: "hierarchy", to: "dedupe", kind: "handoff" },
  ],
  groups: [
    { id: "capture", title: "1 · Capture and understand", note: "From your files to checked knowledge", x: 20, y: 20, w: 1270, h: 700 },
    { id: "create", title: "2 · Create and connect", note: "From knowledge to articles", x: 1310, y: 20, w: 1020, h: 700 },
    { id: "maintain", title: "3 · Maintain and refine", note: "Keep it tidy", x: 2350, y: 20, w: 520, h: 700 },
  ],
};

export const RESEARCH_CANVAS: CanvasDiagram = {
  width: 2080, height: 720,
  nodes: nodesFrom(RESEARCH_FLOW, {
    gap: { shape: "pill", variant: "person", x: 120, y: Y, title: "A specific gap" },
    propose: { shape: "circle", x: 380, y: Y, title: "Propose research", short: "Researcher" },
    "approve-search": { shape: "circle", variant: "independent", x: 640, y: Y, title: "Approve the search", short: "Reviewer" },
    search: { shape: "box", x: 900, y: Y, title: "Web search", short: "Finds candidate pages", icon: Globe },
    select: { shape: "circle", x: 1160, y: Y, title: "Pick excerpts", short: "Researcher" },
    "approve-source": { shape: "circle", variant: "independent", x: 1420, y: Y, title: "Approve the source", short: "Reviewer" },
    admit: { shape: "box", x: 1680, y: Y, title: "Admit evidence", short: "Through Change control", icon: ShieldCheck },
    return: { shape: "circle", x: 1940, y: Y, title: "Update the section", short: "Writer" },
    stop: { shape: "box", variant: "stop", x: 1030, y: 560, title: "Stopped", short: "Reason recorded" },
  }),
  edges: [
    { from: "gap", to: "propose", kind: "handoff", label: "context" },
    { from: "propose", to: "approve-search", kind: "handoff", label: "proposal" },
    { from: "approve-search", to: "search", kind: "handoff", label: "yes" },
    { from: "search", to: "select", kind: "handoff", label: "each page" },
    { from: "select", to: "approve-source", kind: "handoff", label: "excerpts" },
    { from: "approve-source", to: "admit", kind: "handoff", label: "yes" },
    { from: "admit", to: "return", kind: "handoff", label: "new claims" },
    { from: "approve-search", to: "stop", kind: "reject", label: "no", path: "M640 412V560H953", labelAt: [640, 490] },
    { from: "approve-source", to: "stop", kind: "reject", label: "no", path: "M1420 412V560H1107", labelAt: [1420, 490] },
  ],
  groups: [
    { id: "need", title: "1 · Establish the need", note: "Nothing is searched without approval", x: 20, y: 20, w: 750, h: 660 },
    { id: "admit", title: "2 · Admit only useful evidence", note: "Only approved excerpts become claims", x: 790, y: 20, w: 1270, h: 660 },
  ],
};
