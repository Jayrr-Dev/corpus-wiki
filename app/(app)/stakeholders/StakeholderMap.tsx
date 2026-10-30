"use client";

import Link from "next/link";
import { Network } from "lucide-react";
import { useState } from "react";
import { InfoHint } from "@/components/standard/info-hint";
import { cn } from "@/lib/utils";
import { StakeholderBadge } from "./StakeholderCard";
import { MAP_GROUPS, MAX_NODES, type MapEdge, type MapGroup, type MapNode, type StakeholderMapModel } from "./mapLayout";

const GROUP_RINGS: Record<MapGroup, string> = { government: "stroke-blue-500", organization: "stroke-amber-400", person: "stroke-emerald-500" };
const GROUP_DOTS: Record<MapGroup, string> = { government: "bg-blue-500", organization: "bg-amber-400", person: "bg-emerald-500" };
// With this many lines or fewer every line shows its label; past it, only the hovered dot's do
const ALWAYS_LABELLED = 14;
const LONGEST_NAME = 22;
const ARROW_INSIDE = "stakeholder-map-arrow-inside";
const ARROW_PRESSURE = "stakeholder-map-arrow-pressure";

const shortName = (name: string) => (name.length > LONGEST_NAME ? `${name.slice(0, LONGEST_NAME - 1).trimEnd()}…` : name);

// MAP VIEW: stakeholders as dots, the links between them as lines. Hovering a dot lights up its
// lines; clicking it opens the stakeholder.
export function StakeholderMap({ map }: { map: StakeholderMapModel }) {
  const [active, setActive] = useState<string | null>(null);
  if (!map.nodes.length) {
    return (
      <div className="py-16 text-center">
        <Network className="mx-auto mb-4 size-7 text-muted-foreground" />
        <p className="flex items-center justify-center gap-1.5 text-panel font-medium">No links yet<InfoHint>New uploads label who is part of, owns, leads or works in what; the map fills in from those.</InfoHint></p>
      </div>
    );
  }
  const touches = (edge: MapEdge) => edge.fromId === active || edge.toId === active;
  const near = new Set(active ? map.edges.filter(touches).flatMap((edge) => [edge.fromId, edge.toId]) : []);
  const present = MAP_GROUPS.filter(({ group }) => map.nodes.some((node) => node.group === group));
  const labelled = map.edges.length <= ALWAYS_LABELLED;

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            {map.nodes.length} linked
            <InfoHint>Bigger dots hold more power. Gold lines are pressure: regulates, funds or contracts with.</InfoHint>
          </span>
          <span className="flex flex-wrap gap-3">
            {present.map(({ group, label }) => (
              <span key={group} className="flex items-center gap-1.5"><span aria-hidden="true" className={cn("size-2 rounded-full", GROUP_DOTS[group])} />{label}</span>
            ))}
          </span>
        </div>
        <svg viewBox={`0 0 ${map.width} ${map.height}`} role="group" aria-label="Map of stakeholders and their links" className="block h-auto w-full">
          <defs>
            <Arrow id={ARROW_INSIDE} className="fill-faint" />
            <Arrow id={ARROW_PRESSURE} className="fill-needs-you" />
          </defs>
          {map.edges.map((edge) => (
            <Edge key={edge.id} edge={edge} dimmed={active !== null && !touches(edge)} labelled={labelled || (active !== null && touches(edge))} />
          ))}
          {map.nodes.map((node) => (
            <Node key={node.card.entityId} node={node} dimmed={active !== null && node.card.entityId !== active && !near.has(node.card.entityId)} onActive={setActive} />
          ))}
        </svg>
      </div>
      {map.left > 0 && <p className="text-xs text-muted-foreground">Showing the {MAX_NODES} with the most power. Search or filter to see the other {map.left}.</p>}
      {map.loose.length > 0 && (
        <section aria-label="No links" className="space-y-2 border-t pt-5">
          <h2 className="text-sm font-semibold">No links <span className="font-normal text-faint">{map.loose.length}</span></h2>
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {map.loose.map((entry) => <Link key={entry.entityId} href={`/stakeholders/${entry.entityId}`} className="hover:underline">{entry.name}</Link>)}
          </p>
        </section>
      )}
    </div>
  );
}

function Arrow({ id, className }: { id: string; className: string }) {
  return (
    <marker id={id} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L8 4 L0 8 Z" className={className} />
    </marker>
  );
}

function Edge({ edge, dimmed, labelled }: { edge: MapEdge; dimmed: boolean; labelled: boolean }) {
  return (
    <g className={cn("transition-opacity", dimmed && "opacity-20")}>
      <line x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} strokeWidth={1.5} markerEnd={`url(#${edge.pressure ? ARROW_PRESSURE : ARROW_INSIDE})`} className={edge.pressure ? "stroke-needs-you" : "stroke-faint"} />
      {labelled && (
        <text x={(edge.x1 + edge.x2) / 2} y={(edge.y1 + edge.y2) / 2} dy={-4} textAnchor="middle" className={cn("stroke-card stroke-2 text-xs [paint-order:stroke]", edge.pressure ? "fill-needs-you" : "fill-muted-foreground")}>
          {edge.label}
        </text>
      )}
    </g>
  );
}

function Node({ node, dimmed, onActive }: { node: MapNode; dimmed: boolean; onActive: (id: string | null) => void }) {
  const { card, x, y, r } = node;
  const size = r * 2 - 6;
  return (
    <Link href={`/stakeholders/${card.entityId}`} aria-label={card.name}
      onMouseEnter={() => onActive(card.entityId)} onMouseLeave={() => onActive(null)} onFocus={() => onActive(card.entityId)} onBlur={() => onActive(null)}
      className={cn("transition-opacity focus-visible:outline-none", dimmed && "opacity-30")}>
      <circle cx={x} cy={y} r={r} strokeWidth={2} className={cn("fill-card", GROUP_RINGS[node.group])} />
      <foreignObject x={x - size / 2} y={y - size / 2} width={size} height={size}>
        <StakeholderBadge card={card} className="size-full rounded-full text-xs" />
      </foreignObject>
      <text x={x} y={y + r + 15} textAnchor="middle" className={cn("fill-foreground stroke-card stroke-2 text-xs [paint-order:stroke]", node.centre && "font-semibold")}>
        {shortName(card.name)}
      </text>
    </Link>
  );
}
