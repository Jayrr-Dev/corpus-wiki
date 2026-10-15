"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { PageMenu } from "@/app/(app)/_pages/PageMenu";
import { PageIcon } from "@/components/icons";
import { buildPageTree, type PageNode } from "@/lib/living-page/pageHierarchy";
import type { Tables } from "@/lib/database/types";
import { useDomains, useEntities, usePages } from "@/lib/queries";
import { UnitFilterBar } from "@/app/(app)/units/UnitFilterBar";
import { useUnitFilters } from "@/app/(app)/units/useUnitFilters";
import { cn } from "@/lib/utils";

// ROW STYLE SHARED BY PAGE AND DOMAIN ROWS
const rowClass = "flex items-center gap-1.5 rounded-md px-1.5 py-1 text-panel hover:bg-hover";

// TREE INDENT PER DEPTH (static classes so Tailwind generates them; deeper levels reuse the last)
const DEPTH_INDENT = ["pl-1.5", "pl-4.5", "pl-7.5", "pl-10.5", "pl-13.5"] as const;

// SIDEBAR: the pages list and the domain tree, each collapsible
export function SidebarTree() {
  const pathname = usePathname();
  const isPages = pathname === "/" || pathname.startsWith("/p/");
  const isKnowledge = pathname === "/units";
  if (!isPages && !isKnowledge) return null;
  return (
    <aside aria-label={isPages ? "Pages" : "Knowledge filters"} className="hidden w-60 shrink-0 overflow-y-auto border-r bg-sidebar md:block">
      {isPages ? (
        <div className="p-2"><SidebarGroup title="Pages"><PagesList /></SidebarGroup></div>
      ) : (
        <div className="p-4">
          <h2 className="mb-4 text-sm font-semibold">Filter knowledge</h2>
          <Suspense fallback={<SidebarNote text="Loading filters…" />}><KnowledgeFilters /></Suspense>
        </div>
      )}
    </aside>
  );
}

function KnowledgeFilters() {
  const filterState = useUnitFilters();
  const { data: domains = [] } = useDomains();
  const { data: entities = [] } = useEntities();
  return (
    <div className="flex flex-col gap-4">
      <UnitFilterBar {...filterState} domains={domains} entities={entities} vertical />
      <button type="button" onClick={() => filterState.resetFilters()} className="self-start text-xs text-muted-foreground hover:text-foreground">Reset filters</button>
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
      <PageMenu page={node} showUpdate hasChildren={node.children.length > 0} className="invisible group-focus-within:visible group-hover:visible" />
    </div>
    {isOpen && node.children.length ? <PageBranch nodes={node.children} pathname={pathname} depth={depth+1} /> : null}
  </li>;
}

// QUIET ONE-LINE NOTE (loading or empty)
function SidebarNote({ text }: { text: string }) {
  return <p className="px-1.5 py-1 text-panel text-faint">{text}</p>;
}





