"use client";

import { QueryState } from "@/app/(app)/_components/bits";
import { EmptyState } from "@/components/EmptyState";
import { GraphView } from "@/components/graph";
import { GraphIcon } from "@/components/icons";
import { useGraphData } from "@/lib/graph";

// GRAPH SCREEN: loads the graph, then fills the reading area with it (no page padding: the canvas is the page)
export function GraphScreen() {
  const query = useGraphData();
  const isEmpty = query.data?.nodes.length === 0;
  return (
    <div className="h-full">
      <QueryState query={query}>
        {isEmpty ? (
          <EmptyState icon={GraphIcon} title="Nothing to graph yet" hint="Upload a file and its knowledge units appear here." />
        ) : query.data ? (
          <GraphView data={query.data} />
        ) : null}
      </QueryState>
    </div>
  );
}
