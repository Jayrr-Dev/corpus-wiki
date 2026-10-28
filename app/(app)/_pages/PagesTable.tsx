"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { QueryState } from "@/app/(app)/_components/bits";
import { buildPageTree, type PageNode } from "@/lib/living-page/pageHierarchy";
import { Input } from "@/components/ui/input";
import { useMemo, useState } from "react";
import { dateColumn, linkColumn, textColumn } from "@/app/(app)/_components/columns";
import { readsState } from "@/app/(app)/_lib/reads";
import { EmptyState } from "@/components/EmptyState";
import { DataTable } from "@/components/data-table";
import { PageIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { Tables } from "@/lib/database/types";
import { useEntities, usePages } from "@/lib/queries";
import { PageRowActions } from "./PageRowActions";

type PageRow = Tables<"pages"> & { entityName: string };

// COLUMNS: title, the entity it is about, created, and the row actions
const COLUMNS: ColumnDef<PageRow, unknown>[] = [
  linkColumn<PageRow>("title", "Title", (page) => page.title, (page) => `/p/${page.slug}`),
  textColumn<PageRow>("entity", "About", (page) => page.entityName),
  dateColumn<PageRow>("created", "Created", (page) => page.created_at),
  { id: "actions", header: "", enableSorting: false, cell: ({ row }) => <PageRowActions page={row.original} /> },
];

// PAGES TABLE
export function PagesTable() {
  const query = usePageRows();
  const [view, setView] = useState<"hierarchy" | "all">("hierarchy");
  return (<div className="space-y-4"><div className="flex gap-2"><Button size="sm" variant={view === "hierarchy" ? "secondary" : "ghost"} onClick={()=>setView("hierarchy")}>Hierarchy</Button><Button size="sm" variant={view === "all" ? "secondary" : "ghost"} onClick={()=>setView("all")}>All articles</Button></div>{view === "hierarchy" ? <HierarchyBrowser query={query} /> : (
    <DataTable
      query={query}
      columns={COLUMNS}
      getRowId={(page) => page.id}
      filterPlaceholder="Search pages…"
      emptyState={
        <EmptyState
          icon={PageIcon}
          title="No pages yet"
          action={<UploadDocumentsLink />}
        />
      }
    />
  )}</div>);
}

// UPLOAD DOCUMENTS: the empty list's way to the Upload screen
function UploadDocumentsLink() {
  return (
    <Button asChild size="sm" variant="outline">
      <Link href="/upload">Upload documents</Link>
    </Button>
  );
}

// Pages with the name of the entity each is about
function usePageRows() {
  const pages = usePages();
  const entities = useEntities();
  const data = useMemo(() => {
    const nameById = new Map((entities.data ?? []).map((entity) => [entity.id, entity.name]));
    return (pages.data ?? []).map((page) => ({ ...page, entityName: nameById.get(page.context_entity_id ?? page.entity_id ?? "") ?? "—" }));
  }, [pages.data, entities.data]);
  return { data, ...readsState([pages, entities]) };
}

function HierarchyBrowser({query}: {query: ReturnType<typeof usePageRows>}) {
  const [search, setSearch] = useState("");
  const filter = (nodes: PageNode<PageRow>[]): PageNode<PageRow>[] => nodes.flatMap((node) => {
    if (node.title.toLowerCase().includes(search.toLowerCase())) return [node];
    const children=filter(node.children);
    return children.length ? [{...node,children}] : [];
  });
  const roots=filter(buildPageTree(query.data));
  const contexts=roots.filter((node)=>node.context_entity_id);
  const general=roots.filter((node)=>!node.context_entity_id);
  return <QueryState query={query}>
    <div className="space-y-5">
      <Input aria-label="Search page hierarchy" placeholder="Find a page…" value={search} onChange={(event)=>setSearch(event.target.value)} className="max-w-sm" />
      {contexts.length ? <section aria-label="Entity contexts"><h2 className="mb-2 font-semibold">Contexts</h2><HierarchyNodes nodes={contexts} depth={0} searching={!!search} /></section> : null}
      {general.length ? <section aria-label="General knowledge"><h2 className="mb-2 font-semibold">General knowledge</h2><HierarchyNodes nodes={general} depth={0} searching={!!search} /></section> : null}
      {!roots.length ? <EmptyState icon={PageIcon} title={search ? "No matching pages" : "No pages yet"} /> : null}
    </div>
  </QueryState>;
}
function HierarchyNodes({nodes,depth,searching}: {nodes: PageNode<PageRow>[];depth:number;searching:boolean}) {
  return <ul className={depth ? "ml-4 border-l pl-4" : "space-y-1"}>{nodes.map((node)=><HierarchyRow key={node.id} node={node} depth={depth} searching={searching} />)}</ul>;
}
function HierarchyRow({node,depth,searching}: {node: PageNode<PageRow>;depth:number;searching:boolean}) {
  const [open,setOpen]=useState(depth<1);
  const expanded=open || searching;
  return <li>
    <div className="flex items-center gap-2 rounded-md py-2 hover:bg-hover">
      <button type="button" className="w-5 shrink-0 text-faint disabled:invisible" disabled={!node.children.length} aria-label={`${expanded ? "Collapse" : "Expand"} ${node.title}`} aria-expanded={expanded} onClick={()=>setOpen(!open)}>{expanded ? "▾" : "▸"}</button>
      <PageIcon className="shrink-0 text-muted-foreground" /><Link href={`/p/${node.slug}`} className="min-w-0 flex-1 text-link hover:underline">{node.title}</Link>
      {node.children.length ? <span className="text-xs text-faint">{node.children.length} subpages</span> : null}<PageRowActions page={node} />
    </div>
    {expanded && node.children.length ? <HierarchyNodes nodes={node.children} depth={depth+1} searching={searching} /> : null}
  </li>;
}
