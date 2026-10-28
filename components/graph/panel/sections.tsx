"use client";

import { DomainTreeSelect } from "@/components/actions/DomainTreeSelect";
import { Tooltip } from "@/components/standard/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DISPLAY_SLIDERS,
  domainPathsForScope,
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
import { colorGroupTree, type ColorTreeRow } from "@/lib/graph/colorGroupTree";
import { chooseDomainColor } from "@/lib/graph/domainColors";
import { GRAPH_ACCENTS, GRAPH_COLOR_FAMILIES } from "@/lib/graph/groups";
import { cn } from "@/lib/utils";
import { Check, ChevronRight, Plus, SlidersHorizontal } from "lucide-react";
import {
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { PanelSection } from "./PanelSection";
import { SelectRow, SliderRow, SwitchRow } from "./rows";

// =====================================================================
// PANEL SECTIONS: Filters, Nodes, Group, Colors, Tuning. Each takes its
// slice of the settings and one `onChange` for the whole slice.
// =====================================================================

// NODES: which dot kinds appear on the canvas (claims, domain hubs, entities, pages).
export function NodesSection({
  value,
  onChange,
}: {
  value: GraphFilters;
  onChange: (next: GraphFilters) => void;
}) {
  const set = <K extends keyof GraphFilters>(key: K, next: GraphFilters[K]) =>
    onChange({ ...value, [key]: next });
  return (
    <PanelSection title="Nodes" defaultOpen>
      <SwitchRow
        label="Knowledge units"
        checked={value.showUnits}
        onChange={(next) => set("showUnits", next)}
      />
      <SwitchRow
        label="Domains"
        checked={value.showDomains}
        onChange={(next) => set("showDomains", next)}
      />
      <SwitchRow
        label="Entities"
        checked={value.showEntities}
        onChange={(next) => set("showEntities", next)}
      />
      <SwitchRow
        label="Pages"
        checked={value.showPages}
        onChange={(next) => set("showPages", next)}
      />
    </PanelSection>
  );
}

// EDGES: lines between dots. Connectors attach a note to a domain, entity, or page.
// Related links are derived similarity lines between units.
export function EdgesSection({
  value,
  display,
  onChange,
  onDisplayChange,
}: {
  value: GraphFilters;
  display: GraphDisplay;
  onChange: (next: GraphFilters) => void;
  onDisplayChange: (next: GraphDisplay) => void;
}) {
  const set = <K extends keyof GraphFilters>(key: K, next: GraphFilters[K]) =>
    onChange({ ...value, [key]: next });
  return (
    <PanelSection title="Edges" defaultOpen>
      <SwitchRow
        label="Connectors"
        checked={value.showConnectors}
        onChange={(next) => set("showConnectors", next)}
      />
      <SwitchRow
        label="Related links"
        checked={value.showRelated}
        onChange={(next) => set("showRelated", next)}
      />
      <SliderRow
        label="Opacity"
        value={display.edgeOpacity}
        min={0}
        max={1}
        step={0.01}
        onChange={(edgeOpacity) => onDisplayChange({ ...display, edgeOpacity })}
      />
      {value.showRelated ? (
        <SliderRow
          label="Min relatedness"
          value={value.relatedness}
          min={0.05}
          max={0.9}
          step={0.01}
          onChange={(next) => set("relatedness", next)}
        />
      ) : null}
    </PanelSection>
  );
}

// FILTERS: search and one domain to focus on; orphans live under Tuning
export function FiltersSection({
  value,
  nodes,
  onChange,
}: {
  value: GraphFilters;
  nodes: readonly GraphNode[];
  onChange: (next: GraphFilters) => void;
}) {
  const set = <K extends keyof GraphFilters>(key: K, next: GraphFilters[K]) =>
    onChange({ ...value, [key]: next });
  const internal =
    value.domainScope === "internal" || value.domainScope === "both";
  const external =
    value.domainScope === "external" || value.domainScope === "both";
  // Visibility switches filter the canvas, not the choices available in the picker.
  const domains = useMemo(
    () =>
      groupSuggestions(
        nodes.map((node) => ({
          ...node,
          domainPaths: domainPathsForScope(node, "both"),
        })),
      ).domain.map((path) => ({ id: path, path })),
    [nodes],
  );
  const domainGroups = useMemo(
    () =>
      (["internal", "external"] as const).map((scope) => ({
        id: scope,
        label: scope === "internal" ? "Internal" : "External",
        domains: groupSuggestions(
          nodes.map((node) => ({
            ...node,
            domainPaths: domainPathsForScope(node, scope),
          })),
        ).domain.map((path) => ({ id: path, path })),
      })),
    [nodes],
  );
  const selectDomain = (domain: string, scope?: string) => {
    let domainScope = value.domainScope;
    if (scope === "internal" && !internal)
      domainScope = external ? "both" : "internal";
    if (scope === "external" && !external)
      domainScope = internal ? "both" : "external";
    if (!domain && domainScope === "none") domainScope = "both";
    onChange({ ...value, domain, domainScope });
  };
  return (
    <PanelSection title="Filters">
      <Input
        placeholder="Search…"
        value={value.search}
        onChange={(event) => set("search", event.target.value)}
        aria-label="Search the graph"
      />
      <DomainTreeSelect
        label="Show domain"
        emptyLabel="All domains"
        value={value.domain}
        domains={domains}
        groups={domainGroups}
        onChange={selectDomain}
        className="h-7 w-full max-w-none"
      />
    </PanelSection>
  );
}

// GROUP: domain, entity, or page circles. One at a time.
export function GroupSection({
  value,
  onChange,
}: {
  value: GraphDisplay;
  onChange: (next: GraphDisplay) => void;
}) {
  const pick = (mode: "domain" | "entity" | "page", on: boolean) =>
    onChange({ ...value, groupBy: on ? mode : "off" });
  return (
    <PanelSection
      title="Group"
      defaultOpen
      info={
        <>
          <PopoverDescription>
            One grouping can be on at a time.
          </PopoverDescription>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
            <li>
              Domain draws a circle around each topic. That circle is separate
              from the domain node. With Domains on in Nodes, the node sits in
              the middle of its circle and grows with its connections.
            </li>
            <li>
              Entities draws a colored circle around each entity. Knowledge
              units sit inside it. Domain nodes show there only when Domains is
              on in Nodes.
            </li>
            <li>
              Pages draws a circle around each article. Each section is a circle
              inside it, and the knowledge that section uses sits there.
            </li>
            <li>
              A unit used in more than one section sits in the earliest one.
            </li>
            <li>
              Click a selected article, section, or suggestion again to open it.
            </li>
            <li>
              Drag one knowledge unit onto an article, a section, or a
              suggestion. An article drop uses the earliest section that can
              take one claim. A blue suggestion adds it to that new article. An
              orange Merge suggestion adds it to that merge. Go back to the
              overview before dropping it on a different group.
            </li>
            <li>
              Units that no article cites gather in a gray No article circle.
              Inside it, a node with the most connections and the nodes linked
              to it form a nested group, with a black border and that node name.
              Linked nodes that never join a hub sit together in Linked. A node
              with no links at all sits in Orphans. A link to anything else
              leaves it in No article. Nodes from an external source sit in
              External. A pending suggestion groups its units inside that
              circle. A new article is blue. A merge is orange and marked Merge.
              The newest 10% of knowledge units changed, used, moved, or applied
              keep a green border. The newest 10% of articles and the newest 10%
              of sections have a yellow ring. Inside a selected group, that
              share is of the group.
            </li>
          </ul>
        </>
      }
    >
      <SwitchRow
        label="Domain"
        checked={value.groupBy === "domain"}
        onChange={(on) => pick("domain", on)}
      />
      <SwitchRow
        label="Entities"
        checked={value.groupBy === "entity"}
        onChange={(on) => pick("entity", on)}
      />
      <SwitchRow
        label="Pages"
        checked={value.groupBy === "page"}
        onChange={(on) => pick("page", on)}
      />
    </PanelSection>
  );
}

// COLOR SWATCH: a dot in one token color
function Swatch({
  color,
  className,
}: {
  color: GraphColor;
  className?: string;
}) {
  // The token is passed as a custom property; the class paints with it
  const swatchStyle = { "--swatch": `var(--sb-${color})` } as CSSProperties;
  return (
    <span
      className={cn("block size-3.5 rounded-full bg-(--swatch)", className)}
      style={swatchStyle}
    />
  );
}

// Values the group pickers offer, per field
type GroupOptions = ReturnType<typeof groupSuggestions>;

const VALUE_PLACEHOLDERS: Record<"entity" | "text", string> = {
  entity: "Pick or type an entity",
  text: "Words in the title",
};

// VALUE FIELD: the domain tree for domains, a dropdown for the fixed lists (kind, status), a text box with suggestions for the rest
function GroupValue({
  field,
  value,
  options,
  onChange,
}: {
  field: GroupField;
  value: string;
  options: GroupOptions;
  onChange: (next: string) => void;
}) {
  const listId = useId();
  const domains = useMemo(
    () => options.domain.map((path) => ({ id: path, path })),
    [options.domain],
  );
  if (field === "domain") {
    // Matching ignores case, so an older typed value still shows as its domain
    const picked =
      options.domain.find(
        (path) =>
          path.toLowerCase() === value.trim().replace(/\/+$/, "").toLowerCase(),
      ) ?? value;
    return (
      <DomainTreeSelect
        label="Group domain"
        placeholder="Pick a domain"
        value={picked}
        domains={domains}
        onChange={onChange}
        className="h-7 w-full max-w-none"
      />
    );
  }
  if (field === "kind" || field === "status") {
    return (
      <NativeSelect
        size="sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Group value"
        className="w-full"
      >
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

const PALETTE_FAMILY_ORDER = [
  "Red",
  "Orange",
  "Copper",
  "Gold",
  "Lime",
  "Green",
  "Teal",
  "Cyan",
  "Blue",
  "Violet",
  "Purple",
  "Pink",
  "Rose",
];
const PALETTE_FAMILIES = [...GRAPH_COLOR_FAMILIES].sort(
  (a, b) =>
    PALETTE_FAMILY_ORDER.indexOf(a.label) -
    PALETTE_FAMILY_ORDER.indexOf(b.label),
);
const NEUTRAL_TOKENS = new Set<string>([
  "text",
  "muted",
  "faint",
  "graph-slate",
  "graph-sand",
]);

function ColorPalette({
  value,
  onChange,
}: {
  value: GraphColor;
  onChange: (color: GraphColor) => void;
}) {
  const renderColor = (color: { token: GraphColor; label: string }) => (
    <Tooltip key={color.token} content={color.label}>
      <button
        type="button"
        aria-label={color.label}
        aria-pressed={value === color.token}
        onClick={() => onChange(color.token)}
        className="flex size-9 items-center justify-center justify-self-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span
          className={cn(
            "relative rounded-full",
            value === color.token &&
              "ring-2 ring-foreground ring-offset-2 ring-offset-popover",
          )}
        >
          <Swatch color={color.token} className="size-5" />
          {value === color.token ? (
            <Check
              className="absolute -bottom-1 -right-1 size-3 rounded-full bg-foreground p-0.5 text-background"
              aria-hidden
            />
          ) : null}
        </span>
      </button>
    </Tooltip>
  );
  const familyTokens = new Set<string>(
    GRAPH_COLOR_FAMILIES.flatMap((family) =>
      family.colors.map((color) => color.token),
    ),
  );
  return (
    <div
      className="flex w-72 max-w-full flex-col gap-2"
      role="group"
      aria-label="Choose a color"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Color</span>
        <span className="text-xs text-muted-foreground">
          {GRAPH_COLORS.find((color) => color.token === value)?.label}
        </span>
      </div>
      <div className="max-h-[min(26rem,calc(var(--radix-popover-content-available-height,32rem)-5rem))] overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
        <div className="sticky top-0 z-10 grid grid-cols-[minmax(4rem,1fr)_repeat(3,3.5rem)] gap-1 border-b border-border bg-popover pb-2 text-center text-xs text-muted-foreground">
          <span className="text-left">Family</span>
          <span>Light</span>
          <span>Medium</span>
          <span>Dark</span>
        </div>
        {PALETTE_FAMILIES.map((family) => (
          <div
            key={family.label}
            className="grid grid-cols-[minmax(4rem,1fr)_repeat(3,3.5rem)] items-center gap-1 py-0.5"
          >
            <span className="text-xs text-muted-foreground">
              {family.label}
            </span>
            {family.colors.map(renderColor)}
          </div>
        ))}
        {[
          { label: "Extra accents", neutral: false },
          { label: "Neutrals", neutral: true },
        ].map((section) => (
          <div key={section.label} className="mt-3 border-t border-border pt-3">
            <p className="pb-2 text-xs font-medium text-muted-foreground">
              {section.label}
            </p>
            <div className="grid grid-cols-6 gap-1">
              {GRAPH_COLORS.filter(
                (color) =>
                  !familyTokens.has(color.token) &&
                  NEUTRAL_TOKENS.has(color.token) === section.neutral,
              ).map(renderColor)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GroupRuleFields({
  query,
  options,
  onChange,
}: {
  query: string;
  options: GroupOptions;
  onChange: (query: string) => void;
}) {
  const { field, value } = splitGroupQuery(query);
  return (
    <>
      <NativeSelect
        size="sm"
        value={field}
        onChange={(event) =>
          onChange(joinGroupQuery(event.target.value as GroupField, ""))
        }
        aria-label="Match by"
        className="w-full"
      >
        {GROUP_FIELDS.map((option) => (
          <NativeSelectOption key={option.key} value={option.key}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <GroupValue
        field={field}
        value={value}
        options={options}
        onChange={(next) => onChange(joinGroupQuery(field, next))}
      />
    </>
  );
}

// Direct color editing keeps the graph visible; rule editing is secondary.
function ColorGroupRow({
  group,
  count,
  options,
  onChange,
  onRemove,
  branch,
  onToggle,
  searching,
}: {
  group: GraphGroup;
  count: number;
  options: GroupOptions;
  onChange: (next: GraphGroup) => void;
  onRemove: () => void;
  branch: ColorTreeRow;
  onToggle: () => void;
  searching: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const { field, value } = splitGroupQuery(group.query);
  const label = value.trim() || "Choose a match";
  const isChild = field === "domain" && value.includes("/");
  const displayLabel = isChild ? value.split("/").at(-1) : label;
  return (
    <div
      className="group/color flex min-w-0 items-center gap-1 pl-(--branch-indent)"
      style={{ "--branch-indent": `${branch.depth * 10}px` } as CSSProperties}
    >
      {branch.hasChildren ? (
        <button
          type="button"
          aria-label={(branch.expanded ? "Collapse " : "Expand ") + label}
          aria-expanded={branch.expanded}
          disabled={searching}
          onClick={onToggle}
          className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <ChevronRight
            className={cn(
              "size-3 transition-transform",
              branch.expanded && "rotate-90",
            )}
          />
        </button>
      ) : (
        <span className="w-4 shrink-0" />
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip content="Change color" side="right">
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={"Change color for " + label}
              className="flex size-7 shrink-0 items-center justify-center rounded hover:bg-muted/50"
            >
              <Swatch color={group.color} />
            </button>
          </PopoverTrigger>
        </Tooltip>
        <PopoverContent
          side="right"
          align="start"
          className="w-auto"
          aria-label={"Color for " + label}
        >
          <ColorPalette
            value={group.color}
            onChange={(color) => {
              onChange({ ...group, color });
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      <Tooltip
        content={field === "domain" ? label : field + ": " + label}
        side="right"
      >
        <span className="min-w-0 flex-1 truncate text-xs">{displayLabel}</span>
      </Tooltip>
      <span
        className="text-xs tabular-nums text-faint"
        aria-label={count + " dots"}
      >
        {count}
      </span>
      <Popover open={editing} onOpenChange={setEditing}>
        <Tooltip content="Edit matching rule" side="right">
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={"Edit rule for " + label}
              className="flex size-6 shrink-0 items-center justify-center rounded text-faint opacity-0 hover:bg-muted/50 hover:text-foreground focus-visible:opacity-100 group-hover/color:opacity-100 group-focus-within/color:opacity-100 data-[state=open]:opacity-100"
            >
              <SlidersHorizontal className="size-3" />
            </button>
          </PopoverTrigger>
        </Tooltip>
        <PopoverContent side="right" align="start" aria-label="Edit color rule">
          <GroupRuleFields
            query={group.query}
            options={options}
            onChange={(query) => onChange({ ...group, query })}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            className="self-start"
          >
            Remove rule
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// Dismissing the draft leaves no empty saved group behind.
function AddColorGroup({
  value,
  options,
  onAdd,
}: {
  value: GraphGroup[];
  options: GroupOptions;
  onAdd: (group: GraphGroup) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("domain:");
  const [color, setColor] = useState<GraphColor>("applied");
  const [manualColor, setManualColor] = useState(false);
  const changeOpen = (next: boolean) => {
    if (next) {
      setQuery("domain:");
      setManualColor(false);
      setColor(
        GRAPH_ACCENTS.find(
          (candidate) =>
            !value.some((group) => group.color === candidate.token),
        )?.token ?? "applied",
      );
    }
    setOpen(next);
  };
  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <Tooltip content="Add color rule">
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Add color rule"
            className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          >
            <Plus className="size-3.5" />
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent side="right" align="start" aria-label="Add color rule">
        <span className="font-medium">Add color rule</span>
        <GroupRuleFields
          query={query}
          options={options}
          onChange={(next) => {
            setQuery(next);
            const match = splitGroupQuery(next);
            if (!manualColor && match.field === "domain" && match.value.trim())
              setColor(chooseDomainColor(match.value, value));
          }}
        />
        <ColorPalette
          value={color}
          onChange={(next) => {
            setColor(next);
            setManualColor(true);
          }}
        />
        <Button
          size="sm"
          disabled={!splitGroupQuery(query).value.trim()}
          onClick={() => {
            onAdd({ id: crypto.randomUUID(), query, color });
            setOpen(false);
          }}
        >
          Add rule
        </Button>
      </PopoverContent>
    </Popover>
  );
}

export function GroupsSection({
  value,
  nodes,
  showNew,
  onShowNew,
  onChange,
}: {
  value: GraphGroup[];
  nodes: readonly GraphNode[];
  showNew: boolean;
  onShowNew: (showNew: boolean) => void;
  onChange: (next: GraphGroup[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const options = useMemo(() => groupSuggestions(nodes), [nodes]);
  const counts = useMemo(() => groupCounts(value, nodes), [value, nodes]);
  const unassigned = nodes.filter(
    (node) => node.kind === "unit" && node.domainPaths.length === 0,
  ).length;
  const visible = useMemo(
    () => colorGroupTree(value, expanded, search),
    [value, expanded, search],
  );
  return (
    <PanelSection title="Colors" defaultOpen>
      <SwitchRow label="Newest Toggle" checked={showNew} onChange={onShowNew} />
      <div className="flex items-center gap-1">
        {value.length > 6 || search ? (
          <Input
            placeholder="Find a domain…"
            aria-label="Find color groups"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-7 min-w-0 flex-1"
          />
        ) : (
          <span className="flex-1 text-xs text-faint">By domain</span>
        )}
        <AddColorGroup
          value={value}
          options={options}
          onAdd={(group) => {
            onChange([group, ...value]);
            setSearch(splitGroupQuery(group.query).value);
          }}
        />
      </div>
      <div
        className="-mt-2 flex max-h-56 flex-col overflow-y-auto overscroll-contain"
        aria-label="Domain colors"
      >
        {visible.map((branch) => (
          <ColorGroupRow
            key={branch.group.id}
            group={branch.group}
            count={counts.get(branch.group.id) ?? 0}
            options={options}
            branch={branch}
            searching={Boolean(search.trim())}
            onToggle={() =>
              setExpanded((current) => {
                const next = new Set(current);
                if (next.has(branch.group.id)) next.delete(branch.group.id);
                else next.add(branch.group.id);
                return next;
              })
            }
            onChange={(next) =>
              onChange(
                value.map((current) =>
                  current.id === branch.group.id ? next : current,
                ),
              )
            }
            onRemove={() =>
              onChange(
                value.filter((current) => current.id !== branch.group.id),
              )
            }
          />
        ))}
        {!visible.length ? (
          <p className="py-2 text-xs text-faint">
            {search
              ? "No matching domains."
              : options.domain.length
                ? "No color rules. Add a rule to color a domain."
                : "No domains in this space yet."}
          </p>
        ) : null}
      </div>
      {unassigned > 0 ? (
        <p className="text-xs text-muted-foreground">
          {unassigned.toLocaleString()}{" "}
          {unassigned === 1 ? "claim has" : "claims have"} no domain yet.
          Unassigned nodes stay gray; domain colors appear after filing.
        </p>
      ) : null}
    </PanelSection>
  );
}

const TITLE_OPTIONS = TITLE_POSITIONS.map((position) => ({
  value: position,
  label: position[0]!.toUpperCase() + position.slice(1),
}));

function DisplaySliders({
  keys,
  value,
  onChange,
}: {
  keys: readonly (typeof DISPLAY_SLIDERS)[number]["key"][];
  value: GraphDisplay;
  onChange: (next: GraphDisplay) => void;
}) {
  return (
    <>
      {DISPLAY_SLIDERS.filter((rule) => keys.includes(rule.key)).map((rule) => (
        <SliderRow
          key={rule.key}
          label={rule.label}
          min={rule.min}
          max={rule.max}
          step={rule.step}
          value={value[rule.key]}
          onChange={(next) => onChange({ ...value, [rule.key]: next })}
        />
      ))}
    </>
  );
}

// LABELS: where note titles sit and when they fade
function LabelControls({
  value,
  onChange,
}: {
  value: GraphDisplay;
  onChange: (next: GraphDisplay) => void;
}) {
  return (
    <>
      <SelectRow
        label="Title position"
        value={value.titlePosition}
        options={TITLE_OPTIONS}
        onChange={(titlePosition) => onChange({ ...value, titlePosition })}
      />
      <DisplaySliders
        keys={["textFadeThreshold"]}
        value={value}
        onChange={onChange}
      />
    </>
  );
}

// SHAPES: how big the dots and lines are, and the extra marks drawn on them
function ShapeControls({
  value,
  onChange,
}: {
  value: GraphDisplay;
  onChange: (next: GraphDisplay) => void;
}) {
  return (
    <>
      <DisplaySliders
        keys={["nodeSize", "linkThickness"]}
        value={value}
        onChange={onChange}
      />
      <SwitchRow
        label="Arrows"
        checked={value.arrows}
        onChange={(arrows) => onChange({ ...value, arrows })}
      />
    </>
  );
}

// FORCES: the physics sliders, then the replay that shows them settle
function ForceControls({
  value,
  onChange,
  isReplaying,
  onAnimate,
}: {
  value: GraphForces;
  onChange: (next: GraphForces) => void;
  isReplaying: boolean;
  onAnimate: () => void;
}) {
  return (
    <>
      {FORCE_SLIDERS.map((rule) => (
        <SliderRow
          key={rule.key}
          label={rule.label}
          min={rule.min}
          max={rule.max}
          step={rule.step}
          value={value[rule.key]}
          onChange={(next) => onChange({ ...value, [rule.key]: next })}
        />
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={onAnimate}
        className="self-center"
      >
        {isReplaying ? "Stop" : "Animate"}
      </Button>
    </>
  );
}

// SHOW: which domain trees appear (your own sources, outside ones) and whether unlinked claims do
function ShowControls({
  value,
  onChange,
}: {
  value: GraphFilters;
  onChange: (next: GraphFilters) => void;
}) {
  const internal =
    value.domainScope === "internal" || value.domainScope === "both";
  const external =
    value.domainScope === "external" || value.domainScope === "both";
  const setScopes = (nextInternal: boolean, nextExternal: boolean) =>
    onChange({
      ...value,
      domainScope: nextInternal
        ? nextExternal
          ? "both"
          : "internal"
        : nextExternal
          ? "external"
          : "none",
      domain: "",
    });
  return (
    <>
      <SwitchRow
        label="Internal"
        checked={internal}
        onChange={(checked) => setScopes(checked, external)}
      />
      <SwitchRow
        label="External"
        checked={external}
        onChange={(checked) => setScopes(internal, checked)}
      />
      <SwitchRow
        label="Orphans"
        checked={value.showOrphans}
        onChange={(showOrphans) => onChange({ ...value, showOrphans })}
      />
    </>
  );
}

// TUNING GROUP: a smaller fold inside Tuning, closed until asked for
function TuningGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="flex items-center gap-1.5 text-left text-xs font-medium text-faint hover:text-text"
      >
        <ChevronRight
          className={cn("size-3 transition-transform", isOpen && "rotate-90")}
          aria-hidden
        />
        {title}
      </button>
      {isOpen ? (
        <div className="flex flex-col gap-3 pl-4">{children}</div>
      ) : null}
    </div>
  );
}

// TUNING: closed by default so reading the graph comes first. Holds the knobs that shape the
// drawing, then the maintenance actions, which change data and so go last.
export function TuningSection({
  filters,
  display,
  forces,
  onFiltersChange,
  onDisplayChange,
  onForcesChange,
  isReplaying,
  onAnimate,
  actions,
}: {
  filters: GraphFilters;
  display: GraphDisplay;
  forces: GraphForces;
  onFiltersChange: (next: GraphFilters) => void;
  onDisplayChange: (next: GraphDisplay) => void;
  onForcesChange: (next: GraphForces) => void;
  isReplaying: boolean;
  onAnimate: () => void;
  actions?: ReactNode;
}) {
  return (
    <PanelSection title="Tuning">
      <TuningGroup title="Show">
        <ShowControls value={filters} onChange={onFiltersChange} />
      </TuningGroup>
      <TuningGroup title="Labels">
        <LabelControls value={display} onChange={onDisplayChange} />
      </TuningGroup>
      <TuningGroup title="Shapes">
        <ShapeControls value={display} onChange={onDisplayChange} />
      </TuningGroup>
      <TuningGroup title="Forces">
        <ForceControls
          value={forces}
          onChange={onForcesChange}
          isReplaying={isReplaying}
          onAnimate={onAnimate}
        />
      </TuningGroup>
      {actions ? <TuningGroup title="Actions">{actions}</TuningGroup> : null}
    </PanelSection>
  );
}
