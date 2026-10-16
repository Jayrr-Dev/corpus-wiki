"use client";

export { DomainsPageMenu } from "./DomainsPageMenu";

import { useMemo, useState } from "react";
import { ChevronRight, Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DomainUnitsTable } from "../units/UnitsScreen";
import { DomainTabForm } from "./DomainTabForm";
import { Tabs } from "radix-ui";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip } from "@/components/standard/tooltip";
import { QueryState } from "@/app/(app)/_components/bits";
import { readsState } from "@/app/(app)/_lib/reads";
import { EmptyState } from "@/components/EmptyState";
import { DomainIcon } from "@/components/icons";
import { DeleteRetiredForm } from "@/components/actions/DeleteRetiredForm";
import { RetireForm } from "@/components/actions/RetireForm";
import { buildRetireDomain } from "@/components/actions/buildCatalog";
import { RowMenu } from "@/components/row-menu/RowMenu";
import { buildDomainTree, type DomainNode } from "@/lib/domains/tree";
import { useDomainTabs, useDomains, useUnitDomains, useUnits } from "@/lib/queries";
import { deleteDomainAction } from "@/lib/server-actions/catalog";
import { cn } from "@/lib/utils";
import { subtreeCounts, unitsByDomain } from "./countUnits";
import { NewDomainButton, NewDomainForm } from "./NewDomainForm";
import { RenameDomainForm } from "./RenameDomainForm";

// INDENT PER DEPTH (static classes; deeper levels reuse the last)
const DEPTH_INDENT = ["pl-0", "pl-5", "pl-10", "pl-15", "pl-20"] as const;

// DOMAINS TREE: every domain with its current unit count, each opening the filtered unit list;
// `showRetired` also lists retired domains (faint, menu limited to their units)
export function DomainsTree({ showRetired = false }: { showRetired?: boolean }) {
  const tabQuery = useDomainTabs();
  const [creatingTab, setCreatingTab] = useState(false);
  const [editingTab, setEditingTab] = useState(false);
  const customTabs = tabQuery.data ?? [];
  const [tab, setTab] = useState("00000000-0000-4000-8000-000000000001");
  const { tree, counts, state } = useDomainCounts(showRetired);
  return (
    <QueryState query={readsState([state, tabQuery])}>
      <Tabs.Root value={tab} onValueChange={setTab} className="space-y-4">
        <div className="flex items-center gap-2 border-b pb-2">
        <Tabs.List aria-label="Domain groups" className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {customTabs.map((group) => <Tabs.Trigger key={group.id} value={group.id} className={cn("shrink-0 rounded-md px-3 py-2 text-panel transition-colors focus-visible:outline-2 focus-visible:outline-ring", tab === group.id ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground")}>{group.name}</Tabs.Trigger>)}
        </Tabs.List>
          <Dialog open={creatingTab} onOpenChange={setCreatingTab}><Tooltip content="New domain tab"><DialogTrigger asChild><button type="button" aria-label="New domain tab" className="my-auto flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-hover hover:text-foreground"><Plus className="size-4" /></button></DialogTrigger></Tooltip><DialogContent className="sm:max-w-lg">{creatingTab && <DomainTabForm onDone={(id) => { setTab(id); setCreatingTab(false); }} />}</DialogContent></Dialog>
        </div>
        {customTabs.map((group) => <Tabs.Content key={group.id} value={group.id} className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <p className="max-w-prose whitespace-pre-wrap text-panel leading-relaxed text-muted-foreground">{group.description}</p>
            <div className="flex shrink-0 items-center gap-1.5">
              <NewDomainButton tabId={group.id} />
              <Dialog open={tab === group.id && editingTab} onOpenChange={setEditingTab}>
                <Tooltip content="Edit tab"><DialogTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${group.name} tab`}><Settings2 className="size-4" /></Button></DialogTrigger></Tooltip>
                <DialogContent className="sm:max-w-lg">{editingTab && tab === group.id && <DomainTabForm tab={group} onDone={() => setEditingTab(false)} />}</DialogContent>
              </Dialog>
            </div>
          </div>
          <div className="rounded-lg border border-border/70 p-1.5">
            {tree.some((node) => group.root_ids.includes(node.id)) ? <DomainList nodes={tree.filter((node) => group.root_ids.includes(node.id))} depth={0} counts={counts} /> : <EmptyState icon={DomainIcon} title="No roots in this tab yet" />}
          </div>
        </Tabs.Content>)}
      </Tabs.Root>
    </QueryState>
  );
}

type DomainListProps = { nodes: DomainNode[]; depth: number; counts: Map<string, number> };

// ONE LEVEL (recursive)
function DomainList({ nodes, depth, counts }: DomainListProps) {
  return (
    <ul>
      {nodes.map((node) => <DomainBranch key={node.id} node={node} depth={depth} counts={counts} />)}
    </ul>
  );
}

function DomainBranch({ node, depth, counts }: Omit<DomainListProps, "nodes"> & { node: DomainNode }) {
  const [open, setOpen] = useState(false);
  const [unitsOpen, setUnitsOpen] = useState(false);
  const expandable = node.children.length > 0;
  return <Collapsible open={open} onOpenChange={setOpen} asChild>
        <li>
          <div className={cn("flex min-h-11 items-center gap-1 rounded-md pr-1 transition-colors hover:bg-hover focus-within:bg-hover", DEPTH_INDENT[Math.min(depth, DEPTH_INDENT.length - 1)])}>
            {expandable ? <Tooltip content={`${open ? "Collapse" : "Expand"} ${node.name}`}>
              <CollapsibleTrigger asChild><button type="button" aria-label={`${open ? "Collapse" : "Expand"} ${node.name}`} className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
              </button></CollapsibleTrigger>
            </Tooltip> : <span className="size-6 shrink-0" />}
            <Dialog open={unitsOpen} onOpenChange={setUnitsOpen}>
            <DialogTrigger asChild><button
              type="button"
              className={cn("flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-2 pr-2 text-left focus-visible:outline-2 focus-visible:outline-ring", node.retired_at && "text-faint")}
            >
              <DomainIcon className="shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{node.name}</span>
              {node.retired_at ? <span className="text-xs">retired</span> : null}
              <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{counts.get(node.id) ?? 0} <span className="sr-only sm:not-sr-only">{counts.get(node.id) === 1 ? "unit" : "units"}</span></span>
            </button></DialogTrigger>
            <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-5xl">
              <DialogHeader className="mr-8">
                <DialogTitle>{node.name} knowledge units</DialogTitle>
                <DialogDescription>Current knowledge units in {node.path} and its subdomains.</DialogDescription>
              </DialogHeader>
              {unitsOpen && <DomainUnitsTable domainId={node.id} />}
            </DialogContent>
            </Dialog>
            <DomainMenu node={node} onOpenUnits={() => setUnitsOpen(true)} />
          </div>
          {expandable ? <CollapsibleContent><DomainList nodes={node.children} depth={depth + 1} counts={counts} /></CollapsibleContent> : null}
        </li>
  </Collapsible>;
}

// "…" MENU FOR ONE DOMAIN: its units, a new domain under it, rename, retire;
// a retired one: its units or delete it for good
function DomainMenu({ node, onOpenUnits }: { node: DomainNode; onOpenUnits: () => void }) {
  if (node.retired_at) {
    return (
      <RowMenu
        label={node.path}
        items={[
          { label: "Open units", run: onOpenUnits },
          {
            label: "Delete",
            isDestructive: true,
            body: (close) => (
              <DeleteRetiredForm
                title={`Delete “${node.path}” for good?`}
                description="It and the domains under it are removed and cannot be restored. Units filed there lose the tag but are kept."
                action={deleteDomainAction}
                id={node.id}
                onDone={close}
              />
            ),
          },
        ]}
      />
    );
  }
  return (
    <RowMenu
      label={node.path}
      items={[
        { label: "Open units", run: onOpenUnits },
        { label: "New subdomain", separatorBefore: true, body: (close) => <NewDomainForm parentPath={node.path} onDone={close} /> },
        { label: "Rename", body: (close) => <RenameDomainForm domain={node} onDone={close} /> },
        {
          label: "Retire",
          isDestructive: true,
          body: (close) => (
            <RetireForm
              title={`Retire “${node.path}”?`}
              description="It and the domains under it are hidden and the AI stops filing knowledge there. Units keep their links. Undo it from Changes."
              build={(reason) => buildRetireDomain(node.id, reason)}
              onDone={close}
            />
          ),
        },
      ]}
    />
  );
}

// Domain forest (retired domains hidden unless `showRetired`) plus subtree counts of current units
function useDomainCounts(showRetired: boolean) {
  const domains = useDomains();
  const unitDomains = useUnitDomains();
  const units = useUnits();
  const tree = useMemo(() => buildDomainTree((domains.data ?? []).filter((domain) => showRetired || !domain.retired_at)), [domains.data, showRetired]);
  const counts = useMemo(() => {
    const currentIds = new Set((units.data ?? []).filter((unit) => !unit.retired_at).map((unit) => unit.id));
    return subtreeCounts(tree, unitsByDomain(unitDomains.data ?? [], (id) => currentIds.has(id)));
  }, [tree, units.data, unitDomains.data]);
  return { tree, counts, state: readsState([domains, unitDomains, units]) };
}

