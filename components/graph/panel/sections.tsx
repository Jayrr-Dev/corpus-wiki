"use client";

import { type CSSProperties, useId, useMemo, useState } from "react";
import { DomainTreeSelect } from "@/components/actions/DomainTreeSelect";
import { Tooltip } from "@/components/standard/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  DISPLAY_SLIDERS,
  FORCE_SLIDERS,
  GRAPH_COLORS,
  GROUP_FIELDS,
  groupCounts,
  groupSuggestions,
  joinGroupQuery,
  splitGroupQuery,
  TITLE_POSITIONS,
  type GraphColor,
  type GraphDisplay,
  type GraphFilters,
  type GraphForces,
  type GraphGroup,
  type GraphNode,
  type GroupField,
} from "@/lib/graph";
import { cn } from "@/lib/utils";
import { PanelSection } from "./PanelSection";
import { SelectRow, SliderRow, SwitchRow } from "./rows";

// =====================================================================
// PANEL SECTIONS: Filters, Groups, Display, Forces. Each takes its
// slice of the settings and one `onChange` for the whole slice.
// =====================================================================

// FILTERS: search, one domain to focus on (with its subdomains), the extra layers, orphans, and derived related links with their minimum score
export function FiltersSection({ value, nodes, onChange }: { value: GraphFilters; nodes: readonly GraphNode[]; onChange: (next: GraphFilters) => void }) {
  const set = <K extends keyof GraphFilters>(key: K, next: GraphFilters[K]) => onChange({ ...value, [key]: next });
  const domains = useMemo(() => groupSuggestions(nodes).domain.map((path) => ({ id: path, path })), [nodes]);
  return (
    <PanelSection title="Filters">
      <Input placeholder="Search…" value={value.search} onChange={(event) => set("search", event.target.value)} aria-label="Search the graph" />
      <DomainTreeSelect label="Show domain" emptyLabel="All domains" value={value.domain} domains={domains} onChange={(next) => set("domain", next)} className="h-7 w-full max-w-none" />
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

// Values the group pickers offer, per field
type GroupOptions = ReturnType<typeof groupSuggestions>;

const VALUE_PLACEHOLDERS: Record<"entity" | "text", string> = {
  entity: "Pick or type an entity",
  text: "Words in the title",
};

// VALUE FIELD: the domain tree for domains, a dropdown for the fixed lists (kind, status), a text box with suggestions for the rest
function GroupValue({ field, value, options, onChange }: { field: GroupField; value: string; options: GroupOptions; onChange: (next: string) => void }) {
  const listId = useId();
  const domains = useMemo(() => options.domain.map((path) => ({ id: path, path })), [options.domain]);
  if (field === "domain") {
    // Matching ignores case, so an older typed value still shows as its domain
    const picked = options.domain.find((path) => path.toLowerCase() === value.trim().replace(/\/+$/, "").toLowerCase()) ?? value;
    return <DomainTreeSelect label="Group domain" placeholder="Pick a domain" value={picked} domains={domains} onChange={onChange} className="h-7 w-full max-w-none" />;
  }
  if (field === "kind" || field === "status") {
    return (
      <NativeSelect size="sm" value={value} onChange={(event) => onChange(event.target.value)} aria-label="Group value" className="w-full">
        <NativeSelectOption value="">Choose…</NativeSelectOption>
        {options[field].map((option) => (
          <NativeSelectOption key={option} value={option}>
            {option.replaceAll("_", " ")}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    );
  }
  const suggestions = field === "text" ? [] : options[field];
  return (
    <>
      <Input
        value={value}
        placeholder={VALUE_PLACEHOLDERS[field]}
        aria-label="Group value"
        list={suggestions.length ? listId : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="h-7"
      />
      {suggestions.length ? (
        <datalist id={listId}>
          {suggestions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      ) : null}
    </>
  );
}

interface GroupRowProps {
  group: GraphGroup;
  count: number;
  options: GroupOptions;
  onChange: (next: GraphGroup) => void;
  onRemove: () => void;
}

// GROUP ROW: color swatch (opens the palette), what to match, the value, and how many dots it colors
function GroupRow({ group, count, options, onChange, onRemove }: GroupRowProps) {
  const [isPicking, setIsPicking] = useState(false);
  const colorLabel = GRAPH_COLORS.find((color) => color.token === group.color)?.label ?? group.color;
  const { field, value } = splitGroupQuery(group.query);
  const setQuery = (nextField: GroupField, nextValue: string) => onChange({ ...group, query: joinGroupQuery(nextField, nextValue) });
  return (
    <div className="group/row relative flex flex-col gap-1.5 rounded-md border p-2">
      {/* Remove sits outside the card in the section chevron's column, centered on the card, shown on hover or keyboard focus */}
      <Tooltip content="Remove group" side="left">
        <button
          type="button"
          aria-label="Remove group"
          onClick={onRemove}
          className="absolute top-1/2 -left-4 w-2.5 -translate-y-1/2 text-center leading-none text-faint opacity-0 group-hover/row:opacity-100 hover:text-text focus-visible:opacity-100"
        >
          ×
        </button>
      </Tooltip>
      {/* The swatch sits inside the select's left edge, so the select lines up with the value below */}
      <NativeSelect
        size="sm"
        value={field}
        onChange={(event) => setQuery(event.target.value as GroupField, "")}
        aria-label="Match by"
        className="w-full"
        leading={
          <Tooltip content="Change color">
            <button
              type="button"
              aria-label={`Color: ${colorLabel}. Change color`}
              aria-expanded={isPicking}
              onClick={() => setIsPicking((open) => !open)}
              className="rounded-full p-0.5 ring-border hover:ring-1"
            >
              <Swatch color={group.color} />
            </button>
          </Tooltip>
        }
      >
        {GROUP_FIELDS.map((option) => (
          <NativeSelectOption key={option.key} value={option.key}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {isPicking ? (
        <div className="grid grid-cols-8 justify-items-center" role="listbox" aria-label="Group color">
          {GRAPH_COLORS.map((color) => (
            <Tooltip key={color.token} content={color.label}>
              <button
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
            </Tooltip>
          ))}
        </div>
      ) : null}
      <GroupValue field={field} value={value} options={options} onChange={(next) => setQuery(field, next)} />
      {value.trim() ? <span className="text-xs text-faint">{count === 1 ? "Colors 1 dot" : `Colors ${count} dots`}</span> : null}
    </div>
  );
}

// Next unused accent, so each new group starts in a different color
function nextColor(groups: readonly GraphGroup[]): GraphColor {
  const used = new Set(groups.map((group) => group.color));
  return GRAPH_COLORS.find((color) => !used.has(color.token))?.token ?? GRAPH_COLORS[0].token;
}

// GROUPS: ordered list; the first matching group colors a dot
export function GroupsSection({ value, nodes, onChange }: { value: GraphGroup[]; nodes: readonly GraphNode[]; onChange: (next: GraphGroup[]) => void }) {
  const options = useMemo(() => groupSuggestions(nodes), [nodes]);
  const counts = useMemo(() => groupCounts(value, nodes), [value, nodes]);
  const replace = (index: number, next: GraphGroup) => onChange(value.map((group, at) => (at === index ? next : group)));
  const remove = (index: number) => onChange(value.filter((_, at) => at !== index));
  const add = () => onChange([...value, { id: crypto.randomUUID(), query: joinGroupQuery("domain", ""), color: nextColor(value) }]);
  return (
    <PanelSection title="Groups" defaultOpen>
      {value.map((group, index) => (
        <GroupRow
          key={group.id}
          group={group}
          count={counts.get(group.id) ?? 0}
          options={options}
          onChange={(next) => replace(index, next)}
          onRemove={() => remove(index)}
        />
      ))}
      <Button variant="outline" size="sm" onClick={add} className="self-center">
        + Add color group
      </Button>
    </PanelSection>
  );
}

// DISPLAY: arrows, the three sliders, and the replay
const TITLE_OPTIONS = TITLE_POSITIONS.map((position) => ({ value: position, label: position[0]!.toUpperCase() + position.slice(1) }));

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
      <SwitchRow label="Domain circles" checked={value.domainCircles} onChange={(domainCircles) => onChange({ ...value, domainCircles })} />
      <SelectRow label="Title position" value={value.titlePosition} options={TITLE_OPTIONS} onChange={(titlePosition) => onChange({ ...value, titlePosition })} />
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
