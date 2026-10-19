"use client";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Tables } from "@/lib/database/types";
import { buildPageTree, type PageNode } from "@/lib/living-page/pageHierarchy";
import { cn } from "@/lib/utils";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useMemo, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";

type ArticleTreeSelectProps = {
  pages: readonly Tables<"pages">[];
  value: string;
  onChange: (value: string) => void;
};

function ancestorIds(roots: PageNode<Tables<"pages">>[], id: string): string[] {
  const walk = (nodes: PageNode<Tables<"pages">>[], trail: string[]): string[] | null => {
    for (const node of nodes) {
      if (node.id === id) return trail;
      const found = walk(node.children, [...trail, node.id]);
      if (found) return found;
    }
    return null;
  };
  return walk(roots, []) ?? [];
}

// ARTICLE TREE SELECT: pages nested by parent, used to filter units to one branch
export function ArticleTreeSelect({ pages, value, onChange }: ArticleTreeSelectProps) {
  const roots = useMemo(() => buildPageTree([...pages]), [pages]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const selected = pages.find((page) => page.id === value);
  const onOpenChange = (open: boolean) => {
    if (open) setExpanded(new Set([...roots.map((root) => root.id), ...ancestorIds(roots, value)]));
  };
  const setOpen = (id: string, open: boolean) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  const renderNode = (node: PageNode<Tables<"pages">>, depth: number) => {
    const hasChildren = node.children.length > 0;
    const isOpen = expanded.has(node.id);
    const toggle = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setOpen(node.id, !isOpen);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!hasChildren) return;
      if (event.key === "ArrowRight" && !isOpen) {
        event.preventDefault();
        setOpen(node.id, true);
      }
      if (event.key === "ArrowLeft" && isOpen) {
        event.preventDefault();
        setOpen(node.id, false);
      }
    };
    return (
      <div key={node.id}>
        <DropdownMenuItem onSelect={() => onChange(node.id)} onKeyDown={onKeyDown}>
          <span className="w-[calc(var(--depth)*1rem)] shrink-0" style={{ "--depth": depth } as CSSProperties} aria-hidden="true" />
          {hasChildren ? (
            <span role="button" aria-label={isOpen ? `Collapse ${node.title}` : `Expand ${node.title}`} onClick={toggle} className="-my-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-foreground/10">
              {isOpen ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
            </span>
          ) : (
            <span className="size-5 shrink-0" aria-hidden="true" />
          )}
          <span className="truncate">{node.title}</span>
          <CheckIcon className={cn("ml-auto size-3.5", node.id !== value && "invisible")} aria-hidden="true" />
        </DropdownMenuItem>
        {hasChildren && isOpen ? node.children.map((child) => renderNode(child, depth + 1)) : null}
      </div>
    );
  };
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Article"
          className="relative flex h-8 w-fit max-w-64 min-w-36 items-center rounded-lg border border-input bg-transparent py-1 pr-8 pl-2.5 text-left text-panel transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50"
        >
          <span className="truncate">{selected?.title ?? "Any article"}</span>
          <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-96 min-w-56">
        <DropdownMenuItem onSelect={() => onChange("")}>
          <span className="size-5 shrink-0" aria-hidden="true" />
          Any article
          <CheckIcon className={cn("ml-auto size-3.5 text-muted-foreground", value !== "" && "invisible")} aria-hidden="true" />
        </DropdownMenuItem>
        {roots.map((node) => renderNode(node, 0))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
