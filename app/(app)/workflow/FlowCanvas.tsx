"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { ArrowRight, Expand, Minus, Plus, X } from "lucide-react";
import { Tooltip } from "@/components/standard/tooltip";
import { Button } from "@/components/ui/button";
import { roleName } from "@/lib/ai/roles";
import { AI_STAGES, type SkillLibrary } from "@/lib/ai/skills/types";
import { flowRole } from "./flowModel";
import { ACTION_HINTS } from "./aiFlowModel";
import { HALF, LABEL_SPACE, type CanvasDiagram, type CanvasNode } from "./canvasTypes";
import { ROLE_ICONS } from "./roleIcons";
import styles from "./flowCanvas.module.css";

type View = { x: number; y: number; k: number };
type Drawn = { key: string; from: string; to: string; kind: string; path: string; label?: string; at?: [number, number]; needsYou?: boolean };
export type CanvasTab = "roles" | "assignments";
const MIN_ZOOM = 0.12, MAX_ZOOM = 1.6;
const clamp = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
const BUS = "change-control";

// Arrows the canvas draws on its own: hand-offs between shapes (straight when they share a row or
// column, otherwise one elbow), each shape's arrow to the bus, and dotted arrows to stores
function drawEdges(diagram: CanvasDiagram): Drawn[] {
  const byId = new Map(diagram.nodes.map((node) => [node.id, node]));
  const bus = diagram.bus;
  return [
    ...diagram.edges.map((edge): Drawn => {
      const base = { key: `${edge.from}-${edge.to}`, from: edge.from, to: edge.to, kind: edge.kind, label: edge.label };
      if (edge.path) return { ...base, path: edge.path, at: edge.labelAt };
      const a = byId.get(edge.from)!, b = byId.get(edge.to)!;
      const [aw, ah] = HALF[a.shape], [bw, bh] = HALF[b.shape];
      if (a.x === b.x) {
        const down = b.y > a.y;
        const y1 = down ? a.y + ah + LABEL_SPACE : a.y - ah - 2, y2 = down ? b.y - bh - 2 : b.y + bh + LABEL_SPACE;
        return { ...base, path: `M${a.x} ${y1}V${y2}`, at: edge.labelAt ?? [a.x, (y1 + y2) / 2] };
      }
      const right = b.x > a.x;
      const x1 = right ? a.x + aw : a.x - aw, x2 = right ? b.x - bw - 2 : b.x + bw + 2;
      if (a.y === b.y) return { ...base, path: `M${x1} ${a.y}H${x2}`, at: edge.labelAt ?? [(x1 + x2) / 2, a.y - 16] };
      const mid = (x1 + x2) / 2;
      return { ...base, path: `M${x1} ${a.y}H${mid}V${b.y}H${x2}`, at: edge.labelAt ?? [mid, (a.y + b.y) / 2] };
    }),
    ...(bus ? diagram.nodes.filter((node) => node.sends).map((node): Drawn => {
      const above = node.y < bus.y;
      const y1 = above ? node.y + HALF[node.shape][1] + LABEL_SPACE : node.y - HALF[node.shape][1] - 4;
      const y2 = above ? bus.y - 2 : bus.y + bus.h + 2;
      // Below the bus the label sits by its shape, clear of the group title
      return { key: `${node.id}-bus`, from: node.id, to: BUS, kind: "commit", path: `M${node.x} ${y1}V${y2}`, label: node.sends, at: [node.x, above ? (y1 + y2) / 2 : y1 - 34], needsYou: node.needsYou };
    }) : []),
    ...diagram.nodes.filter((node) => node.store).map((node): Drawn => {
      const store = byId.get(node.store!)!;
      return { key: `${node.id}-${store.id}`, from: node.id, to: store.id, kind: "direct", path: `M${node.x} ${node.y - HALF[node.shape][1] - 2}V${store.y + HALF.cylinder[1] + 4}` };
    }),
  ];
}

export function FlowCanvas({ diagram, label, library, onNavigate }: { diagram: CanvasDiagram; label: string; library: SkillLibrary; onNavigate: (tab: CanvasTab) => void }) {
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 0.5 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const markerId = useId().replaceAll(":", "");
  const edges = useMemo(() => drawEdges(diagram), [diagram]);
  const byId = useMemo(() => new Map(diagram.nodes.map((node) => [node.id, node])), [diagram]);
  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const { width, height, bus } = diagram;

  const zoomAt = useCallback((factor: number, px?: number, py?: number) => {
    const rect = viewport.current?.getBoundingClientRect();
    setView((current) => {
      const k = clamp(current.k * factor);
      const cx = px ?? (rect ? rect.width / 2 : 0), cy = py ?? (rect ? rect.height / 2 : 0);
      return { k, x: cx - (cx - current.x) * (k / current.k), y: cy - (cy - current.y) * (k / current.k) };
    });
  }, []);
  const fit = useCallback((whole: boolean) => {
    const rect = viewport.current?.getBoundingClientRect();
    if (!rect) return;
    // The opening view fills the height and starts at the left, so the flow reads from its start.
    // Room is left at the top for the zoom bar and at the bottom for the key
    const fitHeight = (rect.height - 120) / height;
    const k = clamp(whole ? Math.min((rect.width - 40) / width, fitHeight) : Math.min(0.8, fitHeight));
    setView({ k, x: width * k <= rect.width ? (rect.width - width * k) / 2 : 16, y: 56 });
  }, [width, height]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const frame = requestAnimationFrame(() => fit(false));
    // Scrolling pans; Ctrl or ⌘ with the wheel (and a trackpad pinch) zooms at the pointer
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const rect = element!.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) zoomAt(Math.exp(-event.deltaY * 0.0025), event.clientX - rect.left, event.clientY - rect.top);
      else setView((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
    }
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => { cancelAnimationFrame(frame); element.removeEventListener("wheel", onWheel); };
  }, [fit, zoomAt]);

  function onKeyDown(event: KeyboardEvent) {
    if (event.target !== event.currentTarget) return;
    const step = 60;
    const moves: Record<string, () => void> = {
      "+": () => zoomAt(1.2), "=": () => zoomAt(1.2), "-": () => zoomAt(1 / 1.2), "0": () => fit(true),
      ArrowLeft: () => setView((v) => ({ ...v, x: v.x + step })), ArrowRight: () => setView((v) => ({ ...v, x: v.x - step })),
      ArrowUp: () => setView((v) => ({ ...v, y: v.y + step })), ArrowDown: () => setView((v) => ({ ...v, y: v.y - step })),
      Escape: () => setSelectedId(null),
    };
    const move = moves[event.key];
    if (move) { event.preventDefault(); move(); }
  }

  const connected = (edge: Drawn) => !!selectedId && (edge.from === selectedId || edge.to === selectedId);
  const dimmed = (edge: Drawn) => (!!selectedId && !connected(edge)) || undefined;
  // A selected shape keeps itself and its neighbours lit
  const lit = new Set(selectedId ? [selectedId, ...edges.filter(connected).flatMap((edge) => [edge.from, edge.to])] : []);
  const dimShape = (id: string) => !!selectedId && !lit.has(id);

  return <div ref={viewport} className={styles.canvas} data-dragging={dragging} tabIndex={0} onKeyDown={onKeyDown}
    aria-label={`${label}. Drag or scroll to move, Ctrl and scroll or the zoom buttons to zoom, arrow keys to pan.`}
    style={{ "--grid": `${24 * view.k}px`, "--grid-x": `${view.x}px`, "--grid-y": `${view.y}px` } as CSSProperties}
    onPointerDown={(event) => {
      if (event.button !== 0 || (event.target as Element).closest("button, a, summary, [data-ui]")) return;
      drag.current = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }}
    onPointerMove={(event) => {
      const start = drag.current;
      if (!start) return;
      if (Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y) > 3) start.moved = true;
      setView((v) => ({ ...v, x: start.vx + event.clientX - start.x, y: start.vy + event.clientY - start.y }));
    }}
    onPointerUp={() => { if (drag.current && !drag.current.moved) setSelectedId(null); drag.current = null; setDragging(false); }}
    onPointerCancel={() => { drag.current = null; setDragging(false); }}>
    <div className={styles.world} style={{ "--w": `${width}px`, "--h": `${height}px`, "--tx": `${view.x}px`, "--ty": `${view.y}px`, "--k": view.k } as CSSProperties}>
      {diagram.groups.map((group) => <div key={group.id} className={styles.group} data-tone={group.tone} style={{ "--x": `${group.x}px`, "--y": `${group.y}px`, "--w": `${group.w}px`, "--h": `${group.h}px` } as CSSProperties}>
        <span className={styles.groupTitle}>{group.title}</span><span className={styles.groupNote}>{group.note}</span>
      </div>)}

      <svg className={styles.edges} width={width} height={height} aria-hidden="true">
        <defs><marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1L9 5L1 9" fill="none" stroke="context-stroke" strokeWidth="1.6" /></marker></defs>
        {edges.map((edge) => <path key={edge.key} d={edge.path} data-kind={edge.kind} data-active={connected(edge) || undefined} data-dim={dimmed(edge)} markerEnd={`url(#${markerId})`} />)}
      </svg>

      {bus ? <button type="button" className={styles.bus} aria-pressed={selectedId === BUS} data-dim={dimShape(BUS) || undefined} onClick={() => setSelectedId(BUS)}
        style={{ "--x": `${bus.x}px`, "--y": `${bus.y}px`, "--w": `${bus.end - bus.x}px`, "--h": `${bus.h}px` } as CSSProperties}>
        {[0, 1, 2].map((index) => <span key={index}><strong>Change control</strong>Every change is checked here. Safe ones apply; risky ones wait for you.</span>)}
      </button> : null}

      {diagram.nodes.filter((node) => node.shape !== "bus").map((node) => <Shape key={node.id} node={node} selected={selectedId === node.id} dim={dimShape(node.id)} onSelect={() => setSelectedId(node.id)} />)}

      {edges.filter((edge) => edge.label && edge.at).map((edge) => <span key={`${edge.key}-label`} className={styles.edgeLabel} data-kind={edge.kind} data-dim={dimmed(edge)} style={{ "--x": `${edge.at![0]}px`, "--y": `${edge.at![1]}px` } as CSSProperties}>
        {edge.label}
        {edge.needsYou ? <Tooltip content="Some of these wait for you in Exceptions"><span className={styles.needsYou} role="img" aria-label="May need you" /></Tooltip> : null}
      </span>)}
    </div>

    <div className={styles.toolbar} data-ui>
      <Tooltip content="Zoom out"><Button variant="ghost" size="icon-sm" aria-label="Zoom out" disabled={view.k <= MIN_ZOOM} onClick={() => zoomAt(1 / 1.2)}><Minus /></Button></Tooltip>
      <span className={styles.zoomValue} aria-live="polite">{Math.round(view.k * 100)}%</span>
      <Tooltip content="Zoom in"><Button variant="ghost" size="icon-sm" aria-label="Zoom in" disabled={view.k >= MAX_ZOOM} onClick={() => zoomAt(1.2)}><Plus /></Button></Tooltip>
      <Tooltip content="Show the whole flow"><Button variant="ghost" size="icon-sm" aria-label="Show the whole flow" onClick={() => fit(true)}><Expand /></Button></Tooltip>
    </div>

    <Legend diagram={diagram} edges={edges} />

    {selected ? <Details node={selected} library={library} onClose={() => setSelectedId(null)} onNavigate={onNavigate} /> : null}
  </div>;
}

function Shape({ node, selected, dim, onSelect }: { node: CanvasNode; selected: boolean; dim: boolean; onSelect: () => void }) {
  const [w, h] = HALF[node.shape];
  const title = node.roleId ? roleName(node.roleId) : node.title;
  const Icon = node.icon ?? (node.roleId ? ROLE_ICONS[node.roleId] : undefined);
  return <>
    <button type="button" className={styles.shape} data-shape={node.shape} data-variant={node.variant} aria-pressed={selected} data-dim={dim || undefined} onClick={onSelect}
      style={{ "--x": `${node.x - w}px`, "--y": `${node.y - h}px`, "--w": `${w * 2}px`, "--h": `${h * 2}px` } as CSSProperties}>
      {node.shape === "cylinder" ? <svg className={styles.cylinder} viewBox="0 0 140 86" preserveAspectRatio="none" aria-hidden="true"><path d="M1 12C1 5 32 1 70 1S139 5 139 12V74C139 81 108 85 70 85S1 81 1 74Z" /><path d="M1 12C1 19 32 23 70 23S139 19 139 12" fill="none" /></svg> : null}
      <span className={styles.shapeBody}>{Icon ? <Icon className={styles.shapeIcon} aria-hidden="true" /> : null}<span className={styles.shapeTitle}>{title}</span></span>
    </button>
    {node.short ? <span className={styles.short} data-dim={dim || undefined} style={{ "--x": `${node.x}px`, "--y": `${node.y + h + 6}px` } as CSSProperties}>{node.short}</span> : null}
  </>;
}

const KIND: Record<string, string> = { circle: "AI role", box: "App step", pill: "Where it starts", diamond: "You decide", cylinder: "Saved here", bus: "Checks every change" };
function Details({ node, library, onClose, onNavigate }: { node: CanvasNode; library: SkillLibrary; onClose: () => void; onNavigate: (tab: CanvasTab) => void }) {
  const kind = node.variant === "unnamed" ? "AI step · no role name" : node.variant === "independent" ? "AI role · independent check" : KIND[node.shape];
  const roles = node.roles ?? [];
  const hasStage = roles.some((id) => AI_STAGES.some((stage) => stage.id === id));
  return <aside className={styles.details} data-ui aria-label={`${node.title} details`} aria-live="polite">
    <div className="flex items-start justify-between gap-3">
      <div><p className={styles.eyebrow}>{kind}</p><h3 className="text-lg leading-tight font-semibold">{node.roleId ? roleName(node.roleId) : node.title}</h3></div>
      <Tooltip content="Close details"><Button variant="ghost" size="icon-sm" aria-label="Close details" onClick={onClose}><X /></Button></Tooltip>
    </div>
    <dl className={styles.facts}>{node.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.text}</dd></div>)}</dl>
    {node.actions?.length || node.exceptions?.length ? <div className="space-y-1.5">
      <p className={styles.eyebrow}>{node.shape === "diamond" ? "Kinds of exception" : "What it sends"}</p>
      <div className="flex flex-wrap gap-1">
        {node.actions?.map((action) => <Chip key={action} label={action} />)}
        {node.exceptions?.map((exception) => <Chip key={exception} label={exception} person />)}
      </div>
    </div> : null}
    {roles.length ? <div className="space-y-2">
      {roles.map((id) => {
        const role = flowRole(id, library);
        return <details key={id} className={styles.instructions} open={roles.length === 1}>
          <summary><strong>{role.name} instructions</strong><span>{role.skill}{role.version !== undefined ? ` · v${role.version}` : ""}</span></summary>
          <p>{role.instructions}</p>
        </details>;
      })}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => onNavigate("roles")}>Edit in Agent Roles<ArrowRight /></Button>
        {hasStage ? <Button variant="ghost" size="sm" onClick={() => onNavigate("assignments")}>Manage stage skills<ArrowRight /></Button> : null}
      </div>
    </div> : node.instructionsNote ? <p className={styles.note}>{node.instructionsNote}</p> : null}
  </aside>;
}

function Chip({ label, person }: { label: string; person?: boolean }) {
  const chip = <span className={styles.chip} data-person={person || undefined}>{label}</span>;
  return ACTION_HINTS[label] ? <Tooltip content={ACTION_HINTS[label]}>{chip}</Tooltip> : chip;
}

// The key lists only what this diagram draws
function Legend({ diagram, edges }: { diagram: CanvasDiagram; edges: Drawn[] }) {
  const has = (test: (node: CanvasNode) => boolean) => diagram.nodes.some(test);
  const kinds = new Set(edges.map((edge) => edge.kind));
  const items: [boolean, ReactNode, string][] = [
    [has((n) => n.shape === "circle" && !n.variant), <i key="i" data-shape="circle" />, "AI role"],
    [has((n) => n.variant === "independent"), <i key="i" data-shape="circle" data-variant="independent" />, "Independent AI check"],
    [has((n) => n.variant === "unnamed"), <i key="i" data-shape="circle" data-variant="unnamed" />, "AI step, no role name"],
    [has((n) => n.shape === "box"), <i key="i" data-shape="box" />, "App step"],
    [has((n) => n.shape === "diamond"), <i key="i" data-shape="diamond" />, "You decide"],
    [has((n) => n.shape === "pill"), <i key="i" data-shape="pill" />, "Where it starts"],
    [has((n) => n.shape === "cylinder"), <i key="i" data-shape="cylinder" />, "Saved data"],
    [kinds.has("handoff"), <b key="b" data-kind="handoff" />, "Hands work on"],
    [kinds.has("commit"), <b key="b" data-kind="commit" />, "Sends changes"],
    [kinds.has("direct"), <b key="b" data-kind="direct" />, "Saves directly"],
    [kinds.has("decide"), <b key="b" data-kind="decide" />, "Your decision"],
    [kinds.has("reject") || kinds.has("return"), <b key="b" data-kind="reject" />, "Branch or return"],
    [edges.some((edge) => edge.needsYou), <span key="s" className={styles.needsYou} />, "Can wait for you"],
  ];
  return <details className={styles.legend} data-ui open>
    <summary>Key</summary>
    <ul>{items.filter(([show]) => show).map(([, mark, text]) => <li key={text}>{mark}{text}</li>)}</ul>
  </details>;
}
