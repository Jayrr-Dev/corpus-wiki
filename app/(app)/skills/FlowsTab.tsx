"use client";

import { useEffect, useId, useRef, useState, type ComponentType, type CSSProperties } from "react";
import { ArrowDownLeft, ArrowUpRight, Check, Expand, Grip, Minus, Plus, Search, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/standard/tooltip";
import { DomainIcon, DuplicateIcon, EntityIcon, GraphIcon, PageIcon, SourceIcon, UnitIcon, PassageIcon, type IconProps } from "@/components/icons";
import type { SkillLibrary } from "@/lib/ai/skills/types";
import { flowRole, KNOWLEDGE_FLOW, RESEARCH_FLOW, type FlowNode } from "./flowModel";
import styles from "./flows.module.css";

const ICONS: Record<FlowNode["icon"], ComponentType<IconProps>> = {
  source: SourceIcon, roles: GraphIcon, check: ShieldCheck, store: UnitIcon,
  entity: EntityIcon, define: UnitIcon, plan: GraphIcon, write: PassageIcon,
  page: PageIcon, organize: DomainIcon, duplicates: DuplicateIcon, search: Search, stop: X,
};

export function FlowsTab({ library, onNavigate }: { library: SkillLibrary; onNavigate: (tab: "roles" | "assignments") => void }) {
  const [view, setView] = useState<"knowledge" | "research">("knowledge");
  const [selectedId, setSelectedId] = useState("reconcile");
  const [zoom, setZoom] = useState<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState(1000);
  const [dragging, setDragging] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const inspector = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const markerId = useId().replaceAll(":", "");
  const flow = view === "knowledge" ? KNOWLEDGE_FLOW : RESEARCH_FLOW;
  const scale = zoom ?? Math.max(0.6, Math.min(1, viewportWidth / flow.width));
  const selected = flow.nodes.find((node) => node.id === selectedId) ?? flow.nodes[0];
  const selectedRoles = selected.roles?.map((id) => flowRole(id, library)) ?? [];

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setViewportWidth(entry.contentRect.width); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function changeView(next: "knowledge" | "research") {
    setView(next);
    setSelectedId(next === "knowledge" ? "reconcile" : "approve-search");
    setZoom(null);
    viewport.current?.scrollTo({ top: 0, left: 0 });
  }
  function endDrag() { drag.current = null; setDragging(false); }

  return <section aria-label="Workflow diagrams" className="space-y-4">
    <div className={styles.intro}>
      <div><p className={styles.eyebrow}>How your knowledge moves</p><h2 className="text-xl font-semibold tracking-tight">Every role. One connected workflow.</h2><p className="mt-1 text-panel text-muted-foreground">Explore the route from source evidence to living articles. Select a step to see its roles and current skills.</p></div>
      <div className={styles.viewSwitch} aria-label="Choose a flow">
        <button type="button" aria-pressed={view === "knowledge"} onClick={() => changeView("knowledge")}><GraphIcon size={15} /> Knowledge pipeline</button>
        <button type="button" aria-pressed={view === "research"} onClick={() => changeView("research")}><Search size={15} /> Outside research</button>
      </div>
    </div>

    <div className={styles.frame}>
      <div className={styles.toolbar}>
        <div className={styles.boardTitle}><span className={styles.liveDot} /><span>{flow.title}</span></div>
        <div className="flex items-center gap-1">
          <Tooltip content="Zoom out"><Button variant="ghost" size="icon-sm" aria-label="Zoom out" disabled={scale <= 0.35} onClick={() => setZoom(Math.max(0.35, scale - 0.1))}><Minus /></Button></Tooltip>
          <span className={styles.zoomValue} aria-live="polite">{Math.round(scale * 100)}%</span>
          <Tooltip content="Zoom in"><Button variant="ghost" size="icon-sm" aria-label="Zoom in" disabled={scale >= 1.5} onClick={() => setZoom(Math.min(1.5, scale + 0.1))}><Plus /></Button></Tooltip>
          <Tooltip content="Fit diagram to width"><Button variant="ghost" size="icon-sm" aria-label="Fit diagram to width" onClick={() => { setZoom(Math.min(1, viewportWidth / flow.width)); viewport.current?.scrollTo({ top: 0, left: 0 }); }}><Expand /></Button></Tooltip>
        </div>
      </div>
      <p className={styles.boardDescription}>{flow.description}</p>
      <div ref={viewport} className={styles.viewport} data-dragging={dragging} tabIndex={0} aria-label={`${view === "knowledge" ? "Knowledge pipeline" : "Outside research"} board. Scroll to explore; use zoom controls to resize.`}
        onPointerDown={(event) => {
          if (event.pointerType !== "mouse" || event.button !== 0 || (event.target as Element).closest("button")) return;
          const element = event.currentTarget;
          drag.current = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
          element.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          event.currentTarget.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
          event.currentTarget.scrollTop = drag.current.top - (event.clientY - drag.current.y);
        }} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
        <div className={styles.boardSize} style={{ "--scaled-width": `${flow.width * scale}px`, "--scaled-height": `${flow.height * scale}px` } as CSSProperties}>
          <div className={styles.board} style={{ "--board-width": `${flow.width}px`, "--board-height": `${flow.height}px`, "--board-scale": scale } as CSSProperties}>
            <div className={styles.laneLabel} style={{ "--x": "35px", "--y": "28px" } as CSSProperties}><span>01</span> {view === "knowledge" ? "Capture & understand" : "Establish the need"}<ArrowUpRight size={15} /></div>
            <div className={styles.laneLabel} style={{ "--x": "35px", "--y": view === "knowledge" ? "540px" : "385px" } as CSSProperties}><span>02</span> {view === "knowledge" ? "Create & connect" : "Admit only useful evidence"}<ArrowDownLeft size={15} /></div>
            {view === "knowledge" ? <div className={styles.laneLabel} style={{ "--x": "35px", "--y": "835px" } as CSSProperties}><span>03</span> Maintain & refine<ArrowUpRight size={15} /></div> : null}
            <svg className={styles.connections} width={flow.width} height={flow.height} aria-hidden="true">
              <defs><marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1 1L9 5L1 9" fill="none" stroke="context-stroke" strokeWidth="1.5" /></marker></defs>
              {flow.edges.map((edge) => <g key={`${edge.from}-${edge.to}`} data-active={edge.from === selected.id || edge.to === selected.id} data-branch={edge.branch || undefined}>
                <path d={edge.path} markerEnd={`url(#${markerId})`} />
                {edge.label ? <g><rect x={(edge.x ?? 0) - 48} y={(edge.y ?? 0) - 12} width={96} height={24} rx={12} /><text x={edge.x} y={edge.y} dominantBaseline="central" textAnchor="middle">{edge.label}</text></g> : null}
              </g>)}
            </svg>
            {flow.nodes.map((node) => {
              const Icon = ICONS[node.icon];
              return <button key={node.id} type="button" className={styles.node} data-kind={node.kind} aria-pressed={selected.id === node.id} aria-controls={`${markerId}-detail`} onClick={() => setSelectedId(node.id)} style={{ "--x": `${node.x}px`, "--y": `${node.y}px`, "--node-width": `${node.width}px`, "--node-height": `${node.height}px` } as CSSProperties}>
                <span className={styles.nodeLabel}><span>{node.label}</span><Icon size={18} /></span>
                <span className={styles.nodeTitle}>{node.title}</span>
                <span className={styles.nodeDescription}>{node.description}</span>
                {node.roles ? <span className={styles.roleList}>{node.roles.map((id) => {
                  const role = flowRole(id, library);
                  return <span key={id} className={styles.roleRow}><span className={styles.roleDot} /><span><strong>{role.name}</strong><span>{role.skill}{role.version !== undefined ? ` · v${role.version}` : ""}</span></span></span>;
                })}</span> : null}
                {node.kind === "output" ? <span className={styles.outputMark}><Check size={13} /> Source-backed output</span> : null}
              </button>;
            })}
          </div>
        </div>
      </div>
      <div className={styles.footer}>
        <div className={styles.legend}><span><i data-kind="role" />AI role</span><span><i data-kind="gate" />Decision</span><span><i data-kind="system" />App step</span><span><i data-kind="output" />Output</span><span className={styles.branchLegend}>- - Optional / review</span></div>
        <div className="flex items-center gap-3"><span className={styles.panHint}><Grip size={14} /> Drag empty space or scroll to explore</span><Button variant="ghost" size="sm" onClick={() => { inspector.current?.scrollIntoView({ block: "nearest" }); inspector.current?.focus({ preventScroll: true }); }}>Step details ↓</Button></div>
      </div>
    </div>

    <div ref={inspector} tabIndex={-1} id={`${markerId}-detail`} className={styles.inspector} aria-label="Selected step details" aria-live="polite">
      <div><p className={styles.eyebrow}>{selected.label}</p><h3 className="text-lg font-semibold">{selected.title}</h3><p className="mt-2 max-w-3xl text-panel leading-relaxed text-muted-foreground">{selected.detail}</p>
        <div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => onNavigate("roles")}>View roles<ArrowUpRight /></Button><Button variant="ghost" size="sm" onClick={() => onNavigate("assignments")}>Manage stage skills<ArrowUpRight /></Button></div>
      </div>
      {selectedRoles.length ? <div className={styles.detailRoles}>{selectedRoles.map((role) => <details key={role.id} className={styles.detailRole}>
        <summary><span><strong>{role.name}</strong><span>{role.skill}{role.version !== undefined ? ` · v${role.version}` : ""}</span></span><Plus size={14} /></summary>
        <p>{role.instructions}</p>
      </details>)}</div> : <div className={styles.systemNote}><ShieldCheck size={21} /><p>This step follows the app’s built-in processing rules.</p></div>}
    </div>
    <p className="text-xs text-faint">This map shows how the workflow is designed. Skill names reflect your current assignments; it is not a live run monitor.</p>
  </section>;
}
