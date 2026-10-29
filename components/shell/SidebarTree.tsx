"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { Minus, Square } from "lucide-react";
import { PageMenu } from "@/app/(app)/_pages/PageMenu";
import { PageIcon } from "@/components/icons";
import { Tooltip } from "@/components/standard/tooltip";
import { buildPageTree, type PageNode } from "@/lib/living-page/pageHierarchy";
import type { Tables } from "@/lib/database/types";
import { useDomains, useEntities, usePages } from "@/lib/queries";
import { UnitFilterBar } from "@/app/(app)/units/UnitFilterBar";
import { useUnitFilters } from "@/app/(app)/units/useUnitFilters";
import { ChangeFilterBar } from "@/app/(app)/changes/ChangeFilterBar";
import { useChangeFilters } from "@/app/(app)/changes/useChangeFilters";
import { cn } from "@/lib/utils";
import { Loader } from "@/components/standard/loader";
import { CuratePagesButton } from "./CuratePagesButton";

// ROW STYLE SHARED BY PAGE AND DOMAIN ROWS
const rowClass = "flex items-center gap-1.5 rounded-md px-1.5 py-1 text-panel hover:bg-hover";

// TREE INDENT PER DEPTH (static classes so Tailwind generates them; deeper levels reuse the last)
const DEPTH_INDENT = ["pl-1.5", "pl-4.5", "pl-7.5", "pl-10.5", "pl-13.5"] as const;

// TREE CONTEXT: which list the current route shows beside the page (pages, or one of two filter sets)
type TreeKind = "pages" | "knowledge" | "changes";
const TREE_TITLE: Record<TreeKind, string> = { pages: "Pages", knowledge: "Filter knowledge", changes: "Filter changes" };
const TREE_LABEL: Record<TreeKind, string> = { pages: "Pages", knowledge: "Knowledge filters", changes: "Change filters" };

export function useTreeKind(): TreeKind | null {
  const pathname = usePathname();
  if (pathname === "/pages" || pathname.startsWith("/p/")) return "pages";
  if (pathname === "/units") return "knowledge";
  if (pathname === "/changes") return "changes";
  return null;
}

// SIDEBAR: the pages list and the domain tree, each collapsible (desktop and tablet; phones get it in the drawer)
export function SidebarTree() {
  const kind = useTreeKind();
  const [minimized, setMinimized] = useState(false);
  if (!kind) return null;
  const title = TREE_TITLE[kind];
  const minimize = () => setMinimized(true);
  return (
    // floating card: inset from the edges so it reads as separate from the app sidebar;
    // it sizes to its content (capped by the viewport), and minimizing slides it shut
    // leaving a bare outlined square to reopen it
    <aside aria-label={TREE_LABEL[kind]} className={cn("relative hidden shrink-0 overflow-hidden p-2 pr-0 transition-all duration-300 ease-in-out md:block", minimized ? "w-10" : "w-auto")}>
      <Tooltip content={`Expand ${title.toLowerCase()}`} side="right">
        <button type="button" onClick={() => setMinimized(false)} aria-label={`Expand ${title.toLowerCase()}`} tabIndex={minimized ? 0 : -1} aria-hidden={!minimized} className={cn("absolute top-3 left-3 text-faint transition-opacity duration-300 hover:text-foreground", minimized ? "opacity-100 delay-150" : "pointer-events-none opacity-0")}>
          <Square className="size-4" />
        </button>
      </Tooltip>
      <div inert={minimized} className={cn("max-h-full w-max max-w-80 min-w-56 overflow-y-auto rounded-lg border bg-sidebar shadow-md transition-opacity duration-200", minimized && "pointer-events-none opacity-0")}>
        <TreeBody kind={kind} onMinimize={minimize} />
      </div>
    </aside>
  );
}

// MOBILE TREE: the same list inside the phone drawer, under the app links; no minimize there
export function MobileSidebarTree() {
  const kind = useTreeKind();
  if (!kind) return null;
  return (
    <section aria-label={TREE_LABEL[kind]} className="border-t border-sidebar-border [&_a]:min-h-9 [&_button]:min-h-9">
      <TreeBody kind={kind} />
    </section>
  );
}

// TREE BODY: the pages list, or the filters for the current table page
function TreeBody({ kind, onMinimize }: { kind: TreeKind; onMinimize?: () => void }) {
  if (kind === "pages") {
    return <div className="p-2"><SidebarGroup title="Pages" onMinimize={onMinimize} actions={<CuratePagesButton />}><PagesList /></SidebarGroup></div>;
  }
  const title = TREE_TITLE[kind];
  return (
    <div className="p-4">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold">{title}</h2>
        {onMinimize ? <MinimizeButton label={title} onClick={onMinimize} /> : null}
      </div>
      <Suspense fallback={<Loader inline className="px-1.5 py-1" />}>{kind === "changes" ? <ChangeFilters /> : <KnowledgeFilters />}</Suspense>
    </div>
  );
}

function MinimizeButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tooltip content="Minimize" side="right">
      <button type="button" onClick={onClick} aria-label={`Minimize ${label.toLowerCase()}`} className="flex size-6 shrink-0 items-center justify-center text-faint hover:text-foreground">
        <Minus className="size-3.5" />
      </button>
    </Tooltip>
  );
}

function ChangeFilters() {
  const filterState = useChangeFilters();
  return (
    <div className="flex flex-col gap-4">
      <ChangeFilterBar {...filterState} vertical />
      <button type="button" onClick={() => filterState.resetFilters()} className="self-start text-xs text-muted-foreground hover:text-foreground">Reset filters</button>
    </div>
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
function SidebarGroup({ title, onMinimize, actions, children }: { title: string; onMinimize?: () => void; actions?: ReactNode; children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <section>
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          className="flex-1 px-1.5 py-1 text-left text-xs font-medium tracking-wide text-faint uppercase hover:text-muted-foreground"
        >
          {title}
        </button>
        {actions}
        {onMinimize ? <MinimizeButton label={title} onClick={onMinimize} /> : null}
      </div>
      {isOpen ? children : null}
    </section>
  );
}

// PAGES: every wiki page, linking to /p/[slug], with a "…" menu on hover
function PagesList() {
  const pathname = usePathname();
  const { data: pages = [], isPending } = usePages();
  if (isPending) return <Loader inline className="px-1.5 py-1" />;
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
      <PageMenu page={node} showUpdate hasChildren={node.children.length > 0} className="invisible group-focus-within:visible group-hover:visible max-md:visible" />
    </div>
    {isOpen && node.children.length ? <PageBranch nodes={node.children} pathname={pathname} depth={depth+1} /> : null}
  </li>;
}

// QUIET ONE-LINE NOTE (loading or empty)
function SidebarNote({ text }: { text: string }) {
  return <p className="px-1.5 py-1 text-panel text-faint">{text}</p>;
}





