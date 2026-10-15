"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { PageMenu } from "@/app/(app)/_pages/PageMenu";
import { DomainIcon, PageIcon } from "@/components/icons";
import { buildDomainTree, type DomainNode } from "@/lib/domains/tree";
import { buildPageTree, type PageNode } from "@/lib/living-page/pageHierarchy";
import type { Tables } from "@/lib/database/types";
import { domainArticle } from "@/lib/living-page/articleNavigation";
import { useDomains, usePages, useSections, useUnitDomains } from "@/lib/queries";
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
      <SidebarGroup title="Contexts & topics">
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
  return <PageBranch nodes={buildPageTree(pages)} pathname={pathname} depth={0} />;
}

function PageBranch({ nodes, pathname, depth }: { nodes: PageNode<Tables<"pages">>[]; pathname: string; depth: number }) {
  return <ul>{nodes.map((node) => <PageTreeItem key={node.id} node={node} pathname={pathname} depth={depth} />)}</ul>;
}
function PageTreeItem({ node, pathname, depth }: { node: PageNode<Tables<"pages">>; pathname: string; depth: number }) {
  const [isOpen, setIsOpen] = useState(true);
  return <li>
    <div className={cn("group", rowClass, DEPTH_INDENT[Math.min(depth, DEPTH_INDENT.length-1)], pathname === `/p/${node.slug}` && "bg-hover")}>
      <button type="button" aria-label={`${isOpen ? "Collapse" : "Expand"} page ${node.title}`} aria-expanded={isOpen} disabled={!node.children.length} onClick={()=>setIsOpen(!isOpen)} className="w-3 shrink-0 text-faint disabled:invisible">{isOpen ? "▾" : "▸"}</button>
      <Link href={`/p/${node.slug}`} className="flex min-w-0 flex-1 items-center gap-1.5"><PageIcon className="shrink-0 text-muted-foreground" /><span className="truncate">{node.title}</span></Link>
      <PageMenu page={node} className="invisible group-focus-within:visible group-hover:visible" />
    </div>
    {isOpen && node.children.length ? <PageBranch nodes={node.children} pathname={pathname} depth={depth+1} /> : null}
  </li>;
}

// DOMAINS: the tree built from parent_id links
function DomainTreeList() {
  const { data: domains = [], isPending } = useDomains();
  const { data: memberships = [] } = useUnitDomains();
  const tree = useMemo(() => buildDomainTree(domains).filter((node) => node.children.length || !["topics", "general", "knowledge"].includes(node.name.toLowerCase()) || memberships.some((link) => link.domain_id === node.id)), [domains, memberships]);
  const { data: pages = [] } = usePages();
  const { data: sections = [] } = useSections();
  const articleByDomain = Object.fromEntries(domains.flatMap((domain) => { const article = domainArticle(pages, sections, domain); return article ? [[domain.id, `/p/${article.slug}`]] : []; }));
  if (isPending) return <SidebarNote text="Loading…" />;
  if (tree.length === 0) return <SidebarNote text="No domains yet" />;
  return <DomainBranch nodes={tree} depth={0} articleByDomain={articleByDomain} />;
}

// ONE LEVEL OF THE TREE (recursive)
function DomainBranch({ nodes, depth, articleByDomain }: { nodes: DomainNode[]; depth: number; articleByDomain: Record<string, string> }) {
  return (
    <ul>
      {nodes.map((node) => (
        <DomainItem key={node.id} node={node} depth={depth} articleByDomain={articleByDomain} />
      ))}
    </ul>
  );
}

// ONE DOMAIN: a toggle for its children and a link that filters Knowledge to it
function DomainItem({ node, depth, articleByDomain }: { node: DomainNode; depth: number; articleByDomain: Record<string, string> }) {
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
        <Link href={articleByDomain[node.id] ?? `/units?domain=${node.id}`} className="min-w-0 flex-1 truncate">
          {node.name}
        </Link>
        {articleByDomain[node.id] ? <Link href={`/units?domain=${node.id}`} aria-label={`Filter knowledge by ${node.name}`} title="View knowledge units" className="shrink-0 px-1 text-xs text-faint hover:text-text">↗</Link> : null}
      </div>
      {isOpen && hasChildren ? <DomainBranch nodes={node.children} depth={depth + 1} articleByDomain={articleByDomain} /> : null}
    </li>
  );
}

// QUIET ONE-LINE NOTE (loading or empty)
function SidebarNote({ text }: { text: string }) {
  return <p className="px-1.5 py-1 text-panel text-faint">{text}</p>;
}
