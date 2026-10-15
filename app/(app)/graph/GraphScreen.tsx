"use client";

import { QueryState } from "@/app/(app)/_components/bits";
import { EmptyState } from "@/components/EmptyState";
import { GraphView } from "@/components/graph";
import { GraphIcon } from "@/components/icons";
import { useGraphData } from "@/lib/graph";
import { CleanDuplicatesButton } from "./CleanDuplicatesButton";
import { LinkExistingButton } from "./LinkExistingButton";

// GRAPH SCREEN: loads the graph, then fills the reading area with it (no page padding: the canvas is the page),
// with the buttons that link claims ingested before ingest proposed links and run the cleaning cycle
export function GraphScreen() {
  const query = useGraphData();
  const isEmpty = query.data?.nodes.length === 0;
  return (
    <div className="h-full">
      <QueryState query={query}>
        {isEmpty ? (
          <EmptyState icon={GraphIcon} title="Nothing to graph yet" hint="Upload a file and its knowledge units appear here." />
        ) : query.data ? (
          <div className="relative h-full">
            <GraphView data={query.data} />
            <div className="absolute top-3 right-3 flex flex-col items-end gap-2">
              <LinkExistingButton />
              <CleanDuplicatesButton />
            </div>
          </div>
        ) : null}
      </QueryState>
    </div>
  );
}
