"use client";

import { QueryState } from "@/app/(app)/_components/bits";
import { EmptyState } from "@/components/EmptyState";
import { GraphView } from "@/components/graph";
import { GraphIcon } from "@/components/icons";
import { useGraphData } from "@/lib/graph";
import { CleanDuplicatesButton } from "./CleanDuplicatesButton";
import { AutoDescribeEntities } from "./AutoDescribeEntities";
import { LinkExistingButton } from "./LinkExistingButton";
import { Loader } from "@/components/standard/loader";

// GRAPH SCREEN: loads the graph, then fills the reading area with it (no page padding: the canvas is the page).
// Linking and duplicate cleanup live in the graph settings panel.
export function GraphScreen() {
  const query = useGraphData();
  const isEmpty = query.data?.nodes.length === 0;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div data-tour="reading-pane" className="min-h-0 flex-1">
      <QueryState
        query={query}
        loading={
          <Loader className="h-full" />
        }
      >
        {isEmpty ? (
          <EmptyState icon={GraphIcon} title="Nothing to graph yet" hint="Upload a file and its knowledge units appear here." />
        ) : query.data ? (
          <GraphView data={query.data} actions={<div className="flex flex-col gap-2"><LinkExistingButton /><AutoDescribeEntities /><CleanDuplicatesButton /></div>} />
        ) : null}
      </QueryState>
      </div>
    </div>
  );
}
