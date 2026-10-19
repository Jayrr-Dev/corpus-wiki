"use client";

import { useMemo, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { Tabs } from "radix-ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { domainPickerGroup, type DomainPickerGroup } from "@/lib/domains/pickerGroups";

type DomainLike = { id: string; path: string };

type DomainNode = { id: string; path: string; name: string; depth: number; children: DomainNode[] };

type DomainTreeSelectProps = {
  label: string;
  value: string;
  domains: readonly DomainLike[];
  groups?: readonly DomainPickerGroup[];
  onChange: (value: string, groupId?: string) => void;
  // shown as the first item with value "" (e.g. "Any domain")
  emptyLabel?: string;
  // trigger text when nothing is picked and there is no empty item (defaults to the label)
  placeholder?: string;
  className?: string;
};

const SEPARATOR = "/";

// Builds a tree from slash paths. A path whose parent is missing hangs off the nearest existing ancestor (or the root).
export function buildDomainTree(domains: readonly DomainLike[]): DomainNode[] {
  const byPath = new Map<string, DomainNode>();
  const sorted = [...domains].sort((a, b) => a.path.localeCompare(b.path));
  const roots: DomainNode[] = [];
  for (const domain of sorted) {
    const segments = domain.path.split(SEPARATOR);
    let parent: DomainNode | undefined;
    for (let i = segments.length - 1; i > 0 && !parent; i--) parent = byPath.get(segments.slice(0, i).join(SEPARATOR));
    const node: DomainNode = { id: domain.id, path: domain.path, name: segments.at(-1) ?? domain.path, depth: parent ? parent.depth + 1 : 0, children: [] };
    byPath.set(domain.path, node);
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

// Ids of every ancestor of the selected domain, so the selection is visible when the menu opens
function ancestorIds(roots: DomainNode[], id: string): string[] {
  const walk = (nodes: DomainNode[], trail: string[]): string[] | null => {
    for (const node of nodes) {
      if (node.id === id) return trail;
      const found = walk(node.children, [...trail, node.id]);
      if (found) return found;
    }
    return null;
  };
  return walk(roots, []) ?? [];
}

// DOMAIN TREE SELECT: a dropdown of domains nested by path, each level collapsible, showing names not full paths
export function DomainTreeSelect({ label, value, domains, groups, onChange, emptyLabel, placeholder, className }: DomainTreeSelectProps) {
  const roots = useMemo(() => buildDomainTree(domains), [domains]);
  const [activeGroup, setActiveGroup] = useState("");
  const selectedGroup = domainPickerGroup(groups, activeGroup);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const selected = domains.find((domain) => domain.id === value);

  // Opening shows the roots' children and the path down to the current selection
  const onOpenChange = (open: boolean) => {
    if (open) {
      setExpanded(new Set([...roots.map((root) => root.id), ...ancestorIds(roots, value)]));
      const group = groups?.find((group) => group.domains.some((domain) => domain.id === value));
      if (group) setActiveGroup(group.id);
    }
  };

  const setOpen = (id: string, open: boolean) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });

  const renderNode = (node: DomainNode) => {
    const hasChildren = node.children.length > 0;
    const isOpen = expanded.has(node.id);
    const toggle = (event: MouseEvent) => {
      // keep the click on the chevron from selecting the row
      event.preventDefault();
      event.stopPropagation();
      setOpen(node.id, !isOpen);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!hasChildren) return;
      if (event.key === "ArrowRight" && !isOpen) { event.preventDefault(); setOpen(node.id, true); }
      if (event.key === "ArrowLeft" && isOpen) { event.preventDefault(); setOpen(node.id, false); }
    };
    return (
      <div key={node.id}>
        <DropdownMenuItem
          onSelect={() => onChange(node.id, selectedGroup?.id)}
          onKeyDown={onKeyDown}
        >
          <span className="w-[calc(var(--depth)*1rem)] shrink-0" style={{ "--depth": node.depth } as CSSProperties} aria-hidden="true" />
          {hasChildren ? (
            <span role="button" aria-label={isOpen ? `Collapse ${node.name}` : `Expand ${node.name}`} onClick={toggle} className="-my-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-foreground/10">
              {isOpen ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
            </span>
          ) : (
            <span className="size-5 shrink-0" aria-hidden="true" />
          )}
          <span className="truncate">{node.name}</span>
          <span className="ml-auto flex items-center gap-1.5 pl-3 text-xs text-muted-foreground">
            {hasChildren ? node.children.length : null}
            <CheckIcon className={cn("size-3.5", node.id !== value && "invisible")} aria-hidden="true" />
          </span>
        </DropdownMenuItem>
        {hasChildren && isOpen ? node.children.map(renderNode) : null}
      </div>
    );
  };

  const trigger = (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        aria-label={label}
        className={cn(
          "relative flex h-8 w-fit max-w-64 min-w-0 items-center rounded-lg border border-input bg-transparent py-1 pr-8 pl-2.5 text-left text-panel transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50",
          className,
        )}
      >
        <span className="truncate">{selected ? (selected.path.split(SEPARATOR).at(-1) ?? selected.path) : (emptyLabel ?? placeholder ?? label)}</span>
        <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      </button>
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      {trigger}
      <DropdownMenuContent className="max-h-96 min-w-56">
        {emptyLabel !== undefined ? (
          <DropdownMenuItem onSelect={() => onChange("")}>
            <span className="size-5 shrink-0" aria-hidden="true" />
            {emptyLabel}
            <CheckIcon className={cn("ml-auto size-3.5 text-muted-foreground", value !== "" && "invisible")} aria-hidden="true" />
          </DropdownMenuItem>
        ) : null}
        {groups?.length ? (
          <Tabs.Root value={selectedGroup?.id} onValueChange={setActiveGroup}>
            <Tabs.List aria-label="Domain type" className="mb-1 flex gap-1 border-b p-1" onKeyDown={(event) => event.stopPropagation()}>
              {groups.map((group) => (
                <Tabs.Trigger key={group.id} value={group.id} className="flex-1 rounded px-3 py-1 text-panel text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-accent data-[state=active]:text-accent-foreground">
                  {group.label} <span className="ml-1 text-muted-foreground">({group.domains.length})</span>
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            {groups.map((group) => (
              <Tabs.Content key={group.id} value={group.id}>
                {group.domains.length ? buildDomainTree(group.domains).map(renderNode) : (
                  <p className="px-2 py-3 text-panel text-muted-foreground">No {group.label.toLowerCase()} domains</p>
                )}
              </Tabs.Content>
            ))}
          </Tabs.Root>
        ) : roots.map(renderNode)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
