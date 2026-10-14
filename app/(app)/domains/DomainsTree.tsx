"use client";

import Link from "next/link";
import { useMemo } from "react";
import { QueryState } from "@/app/(app)/_components/bits";
import { readsState } from "@/app/(app)/_lib/reads";
import { EmptyState } from "@/components/EmptyState";
import { DomainIcon } from "@/components/icons";
import { buildDomainTree, type DomainNode } from "@/lib/domains/tree";
import { useDomains, useUnitDomains, useUnits } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { subtreeCounts, unitsByDomain } from "./countUnits";

// INDENT PER DEPTH (static classes; deeper levels reuse the last)
const DEPTH_INDENT = ["pl-0", "pl-5", "pl-10", "pl-15", "pl-20"] as const;

// DOMAINS TREE: every domain with its current unit count, each opening the filtered unit list
export function DomainsTree() {
  const { tree, counts, state } = useDomainCounts();
  return (
    <QueryState query={state}>
      {tree.length === 0 ? <EmptyState icon={DomainIcon} title="No domains yet" /> : <DomainList nodes={tree} depth={0} counts={counts} />}
    </QueryState>
  );
}

type DomainListProps = { nodes: DomainNode[]; depth: number; counts: Map<string, number> };

// ONE LEVEL (recursive)
function DomainList({ nodes, depth, counts }: DomainListProps) {
  return (
    <ul>
      {nodes.map((node) => (
        <li key={node.id}>
          <Link
            href={`/units?domain=${node.id}`}
            className={cn("flex items-center gap-2 rounded-md py-1.5 pr-2 hover:bg-hover", DEPTH_INDENT[Math.min(depth, DEPTH_INDENT.length - 1)])}
          >
            <DomainIcon className="shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate">{node.name}</span>
            <span className="font-mono text-xs text-faint">{counts.get(node.id) ?? 0}</span>
          </Link>
          {node.children.length > 0 ? <DomainList nodes={node.children} depth={depth + 1} counts={counts} /> : null}
        </li>
      ))}
    </ul>
  );
}

// Domain forest plus subtree counts of current units
function useDomainCounts() {
  const domains = useDomains();
  const unitDomains = useUnitDomains();
  const units = useUnits();
  const tree = useMemo(() => buildDomainTree(domains.data ?? []), [domains.data]);
  const counts = useMemo(() => {
    const currentIds = new Set((units.data ?? []).filter((unit) => !unit.retired_at).map((unit) => unit.id));
    return subtreeCounts(tree, unitsByDomain(unitDomains.data ?? [], (id) => currentIds.has(id)));
  }, [tree, units.data, unitDomains.data]);
  return { tree, counts, state: readsState([domains, unitDomains, units]) };
}
