"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { PageMenu } from "@/app/(app)/_pages/PageMenu";
import { DomainIcon, PageIcon } from "@/components/icons";
import { buildDomainTree, type DomainNode } from "@/lib/domains/tree";
import { useDomains, usePages } from "@/lib/queries";
import { cn } from "@/lib/utils";

// ROW STYLE SHARED BY PAGE AND DOMAIN ROWS
const rowClass = "flex items-center gap-1.5 rounded-md px-1.5 py-1 text-panel hover:bg-hover";

// TREE INDENT PER DEPTH (static classes so Tailwind generates them; deeper levels reuse the last)
const DEPTH_INDENT = ["pl-1.5", "pl-4.5", "pl-7.5", "pl-10.5", "pl-13.5"] as const;

// SIDEBAR: the pages list and the domain tree, each collapsible
export function SidebarTree() {
  return (
    <div className="flex flex-col gap-3 p-2">
      <SidebarGroup title="Pages">
        <PagesList />
      </SidebarGroup>
      <SidebarGroup title="Domains">
        <DomainTreeList />
      </SidebarGroup>
    </div>
  );
}

// COLLAPSIBLE GROUP WITH A SMALL CAPS HEADER
function SidebarGroup({ title, children }: { title: string; children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <section>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="w-full px-1.5 py-1 text-left text-xs font-medium tracking-wide text-faint uppercase hover:text-muted-foreground"
      >
        {title}
      </button>
      {isOpen ? children : null}
    </section>
  );
}

// PAGES: every wiki page, linking to /p/[slug], with a "…" menu on hover
function PagesList() {
  const pathname = usePathname();
  const { data: pages = [], isPending } = usePages();
  if (isPending) return <SidebarNote text="Loading…" />;
  if (pages.length === 0) return <SidebarNote text="No pages yet" />;
  return (
    <ul>
      {pages.map((page) => (
        <li key={page.id} className={cn("group", rowClass, pathname === `/p/${page.slug}` && "bg-hover")}>
          <Link href={`/p/${page.slug}`} className="flex min-w-0 flex-1 items-center gap-1.5">
            <PageIcon className="shrink-0 text-muted-foreground" />
            <span className="truncate">{page.title}</span>
          </Link>
          <PageMenu page={page} className="invisible group-focus-within:visible group-hover:visible" />
        </li>
      ))}
    </ul>
  );
}

// DOMAINS: the tree built from parent_id links
function DomainTreeList() {
  const { data: domains = [], isPending } = useDomains();
  const tree = useMemo(() => buildDomainTree(domains), [domains]);
  if (isPending) return <SidebarNote text="Loading…" />;
  if (tree.length === 0) return <SidebarNote text="No domains yet" />;
  return <DomainBranch nodes={tree} depth={0} />;
}

// ONE LEVEL OF THE TREE (recursive)
function DomainBranch({ nodes, depth }: { nodes: DomainNode[]; depth: number }) {
  return (
    <ul>
      {nodes.map((node) => (
        <DomainItem key={node.id} node={node} depth={depth} />
      ))}
    </ul>
  );
}

// ONE DOMAIN: a toggle for its children and a link that filters Knowledge to it
function DomainItem({ node, depth }: { node: DomainNode; depth: number }) {
  const [isOpen, setIsOpen] = useState(depth < 1);
  const hasChildren = node.children.length > 0;
  return (
    <li>
      <div className={cn(rowClass, DEPTH_INDENT[Math.min(depth, DEPTH_INDENT.length - 1)])}>
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          disabled={!hasChildren}
          aria-label={isOpen ? `Collapse ${node.name}` : `Expand ${node.name}`}
          className="w-3 text-faint disabled:invisible"
        >
          {isOpen ? "▾" : "▸"}
        </button>
        <DomainIcon className="shrink-0 text-muted-foreground" />
        <Link href={`/units?domain=${node.id}`} className="truncate">
          {node.name}
        </Link>
      </div>
      {isOpen && hasChildren ? <DomainBranch nodes={node.children} depth={depth + 1} /> : null}
    </li>
  );
}

// QUIET ONE-LINE NOTE (loading or empty)
function SidebarNote({ text }: { text: string }) {
  return <p className="px-1.5 py-1 text-panel text-faint">{text}</p>;
}
