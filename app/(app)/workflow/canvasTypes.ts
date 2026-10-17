import type { LucideIcon } from "lucide-react";

// FLOW CANVAS: the shapes, arrows and groups both workflow diagrams are drawn from. Circles are AI,
// boxes are app steps, diamonds are your decisions, cylinders are saved data, pills are where a run
// starts, and the optional bus is Change control. Coordinates are canvas pixels at 100% zoom.
export type Shape = "circle" | "box" | "pill" | "diamond" | "cylinder" | "bus";
export type Fact = { label: string; text: string };
export type CanvasNode = {
  id: string; shape: Shape; x: number; y: number; title: string; short?: string;
  variant?: "unnamed" | "independent" | "person" | "store" | "stop";
  // roleId names the shape after the app's role (roleName); icon overrides the role's icon
  roleId?: string; icon?: LucideIcon;
  // Role ids whose instructions the details panel shows
  roles?: string[]; facts: Fact[]; instructionsNote?: string;
  // Short label on the arrow to the bus, and whether that change can wait for you
  sends?: string; needsYou?: boolean; actions?: string[]; exceptions?: string[];
  // A cylinder this step saves to directly
  store?: string;
};
export type CanvasEdge = { from: string; to: string; label?: string; kind: "handoff" | "commit" | "decide" | "return" | "reject"; path?: string; labelAt?: [number, number] };
export type CanvasGroup = { id: string; title: string; note: string; x: number; y: number; w: number; h: number; tone?: "person" };
export type CanvasBus = { x: number; end: number; y: number; h: number };
export type CanvasDiagram = { width: number; height: number; nodes: CanvasNode[]; edges: CanvasEdge[]; groups: CanvasGroup[]; bus?: CanvasBus };

// Half width and height of each shape, for placing arrows on their edges
export const HALF: Record<Shape, [number, number]> = { circle: [56, 56], box: [75, 36], pill: [85, 26], diamond: [60, 60], cylinder: [70, 43], bus: [0, 45] };
// Room below a shape for its short label
export const LABEL_SPACE = 36;
