"use client";

import { type CSSProperties, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DISPLAY_SLIDERS,
  FORCE_SLIDERS,
  GRAPH_COLORS,
  type GraphColor,
  type GraphDisplay,
  type GraphFilters,
  type GraphForces,
  type GraphGroup,
} from "@/lib/graph";
import { cn } from "@/lib/utils";
import { PanelSection } from "./PanelSection";
import { SliderRow, SwitchRow } from "./rows";

// =====================================================================
// PANEL SECTIONS: Filters, Groups, Display, Forces. Each takes its
// slice of the settings and one `onChange` for the whole slice.
// =====================================================================

// FILTERS: search, the extra layers, orphans, and derived related links with their minimum score
export function FiltersSection({ value, onChange }: { value: GraphFilters; onChange: (next: GraphFilters) => void }) {
  const set = <K extends keyof GraphFilters>(key: K, next: GraphFilters[K]) => onChange({ ...value, [key]: next });
  return (
    <PanelSection title="Filters">
      <Input placeholder="Search…" value={value.search} onChange={(event) => set("search", event.target.value)} aria-label="Search the graph" />
      <SwitchRow label="Entities" checked={value.showEntities} onChange={(next) => set("showEntities", next)} />
      <SwitchRow label="Pages" checked={value.showPages} onChange={(next) => set("showPages", next)} />
      <SwitchRow label="Orphans" checked={value.showOrphans} onChange={(next) => set("showOrphans", next)} />
      <SwitchRow label="Related links" checked={value.showRelated} onChange={(next) => set("showRelated", next)} />
      {value.showRelated ? (
        <SliderRow label="Min relatedness" value={value.relatedness} min={0.05} max={0.9} step={0.01} onChange={(next) => set("relatedness", next)} />
      ) : null}
    </PanelSection>
  );
}

// COLOR SWATCH: a dot in one token color
function Swatch({ color, className }: { color: GraphColor; className?: string }) {
  // The token is passed as a custom property; the class paints with it
  const swatchStyle = { "--swatch": `var(--sb-${color})` } as CSSProperties;
  return <span className={cn("block size-3.5 rounded-full bg-(--swatch)", className)} style={swatchStyle} />;
}

// GROUP ROW: query, a swatch that opens the palette, and remove
function GroupRow({ group, onChange, onRemove }: { group: GraphGroup; onChange: (next: GraphGroup) => void; onRemove: () => void }) {
  const [isPicking, setIsPicking] = useState(false);
  const colorLabel = GRAPH_COLORS.find((color) => color.token === group.color)?.label ?? group.color;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <Input
          value={group.query}
          placeholder="domain:Projects/Alpha"
          aria-label="Group query"
          onChange={(event) => onChange({ ...group, query: event.target.value })}
          className="h-7"
        />
        <button type="button" aria-label={`Color: ${colorLabel}`} aria-expanded={isPicking} onClick={() => setIsPicking((open) => !open)} className="rounded-full p-0.5 ring-border hover:ring-1">
          <Swatch color={group.color} />
        </button>
        <button type="button" aria-label="Remove group" onClick={onRemove} className="px-1 text-faint hover:text-text">
          ×
        </button>
      </div>
      {isPicking ? (
        <div className="flex flex-wrap gap-1.5" role="listbox" aria-label="Group color">
          {GRAPH_COLORS.map((color) => (
            <button
              key={color.token}
              type="button"
              role="option"
              aria-selected={color.token === group.color}
              aria-label={color.label}
              onClick={() => {
                onChange({ ...group, color: color.token });
                setIsPicking(false);
              }}
              className={cn("rounded-full p-0.5", color.token === group.color && "ring-1 ring-muted-foreground")}
            >
              <Swatch color={color.token} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Next unused accent, so each new group starts in a different color
function nextColor(groups: readonly GraphGroup[]): GraphColor {
  const used = new Set(groups.map((group) => group.color));
  return GRAPH_COLORS.find((color) => !used.has(color.token))?.token ?? GRAPH_COLORS[0].token;
}

// GROUPS: ordered list; the first matching group colors a dot
export function GroupsSection({ value, onChange }: { value: GraphGroup[]; onChange: (next: GraphGroup[]) => void }) {
  const replace = (index: number, next: GraphGroup) => onChange(value.map((group, at) => (at === index ? next : group)));
  const remove = (index: number) => onChange(value.filter((_, at) => at !== index));
  const add = () => onChange([...value, { id: crypto.randomUUID(), query: "", color: nextColor(value) }]);
  return (
    <PanelSection title="Groups" defaultOpen>
      {value.map((group, index) => (
        <GroupRow key={group.id} group={group} onChange={(next) => replace(index, next)} onRemove={() => remove(index)} />
      ))}
      <Button variant="outline" size="sm" onClick={add} className="self-center">
        New group
      </Button>
    </PanelSection>
  );
}

// DISPLAY: arrows, the three sliders, and the replay
export function DisplaySection({
  value,
  onChange,
  isReplaying,
  onAnimate,
}: {
  value: GraphDisplay;
  onChange: (next: GraphDisplay) => void;
  isReplaying: boolean;
  onAnimate: () => void;
}) {
  return (
    <PanelSection title="Display">
      <SwitchRow label="Arrows" checked={value.arrows} onChange={(arrows) => onChange({ ...value, arrows })} />
      {DISPLAY_SLIDERS.map((rule) => (
        <SliderRow key={rule.key} label={rule.label} min={rule.min} max={rule.max} step={rule.step} value={value[rule.key]} onChange={(next) => onChange({ ...value, [rule.key]: next })} />
      ))}
      <Button variant="outline" size="sm" onClick={onAnimate} className="self-center">
        {isReplaying ? "Stop" : "Animate"}
      </Button>
    </PanelSection>
  );
}

// FORCES: the four physics sliders
export function ForcesSection({ value, onChange }: { value: GraphForces; onChange: (next: GraphForces) => void }) {
  return (
    <PanelSection title="Forces">
      {FORCE_SLIDERS.map((rule) => (
        <SliderRow key={rule.key} label={rule.label} min={rule.min} max={rule.max} step={rule.step} value={value[rule.key]} onChange={(next) => onChange({ ...value, [rule.key]: next })} />
      ))}
    </PanelSection>
  );
}
