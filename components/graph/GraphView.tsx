"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { applyFilters, createdBy, DEFAULT_GRAPH_SETTINGS, withRelated, type GraphData, type GraphNode } from "@/lib/graph";
import { Button } from "@/components/ui/button";
import { GraphCanvas } from "./GraphCanvas";
import { GraphPanel } from "./panel/GraphPanel";
import { UnitPreviewDialog } from "./UnitPreviewDialog";
import { GLOBAL_GRAPH_SETTINGS_KEY, useGraphSettings } from "./useGraphSettings";
import { useReplay } from "./useReplay";

// =====================================================================
// GRAPH VIEW (global): the whole knowledge graph on a canvas, with the
// floating settings panel. What shows = derived "similar" links added,
// then the replay cut, then filters.
// =====================================================================

export function GraphView({ data, actions }: { data: GraphData; actions?: ReactNode }) {
  const router = useRouter();
  const { settings, update, reset } = useGraphSettings(GLOBAL_GRAPH_SETTINGS_KEY, data.nodes);
  const replay = useReplay(data.nodes);
  // A clicked unit previews in a dialog; entities and pages open directly
  const [preview, setPreview] = useState<GraphNode | null>(null);
  const { showRelated, relatedness } = settings.filters;

  // Related links come from the full graph, so the replay grows them with their units
  const related = useMemo(() => withRelated(data, { show: showRelated, threshold: relatedness }), [data, showRelated, relatedness]);

  const visible = useMemo(() => {
    const grown = replay.cutoff === null ? related : createdBy(related, replay.cutoff);
    return applyFilters(grown, settings.filters);
  }, [related, replay.cutoff, settings.filters]);

  return (
    <div className="relative h-full">
      <GraphCanvas graph={visible} settings={settings} onOpen={(node) => (node.kind === "unit" ? setPreview(node) : router.push(node.href))} />
      {visible.nodes.length === 0 && data.nodes.length > 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center pl-64 pr-4" role="status">
          <div className="pointer-events-auto flex max-w-sm flex-col items-center gap-3 rounded-lg border bg-background p-6 text-center shadow-sm">
            <p className="font-medium">No nodes match the current filters</p>
            <p className="text-sm text-muted-foreground">Your graph has {data.nodes.length} nodes. Try including both internal and external domains or clearing your filters.</p>
            <Button variant="outline" onClick={() => {
              replay.stop();
              update("filters", { ...DEFAULT_GRAPH_SETTINGS.filters, domainScope: "both", showEntities: true, showPages: true });
            }}>Show all nodes</Button>
          </div>
        </div>
      )}
      <GraphPanel
        settings={settings}
        nodes={data.nodes}
        update={update}
        reset={reset}
        isReplaying={replay.isPlaying}
        onAnimate={replay.isPlaying ? replay.stop : replay.start}
        actions={actions}
      />
      <p className="pointer-events-none absolute right-3 bottom-2 font-mono text-xs text-faint">
        {visible.nodes.length} nodes · {visible.links.length} links
      </p>
      <UnitPreviewDialog node={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
