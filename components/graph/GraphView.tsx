"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { applyFilters, createdBy, withRelated, type GraphData } from "@/lib/graph";
import { GraphCanvas } from "./GraphCanvas";
import { GraphPanel } from "./panel/GraphPanel";
import { GLOBAL_GRAPH_SETTINGS_KEY, useGraphSettings } from "./useGraphSettings";
import { useReplay } from "./useReplay";

// =====================================================================
// GRAPH VIEW (global): the whole knowledge graph on a canvas, with the
// floating settings panel. What shows = derived "similar" links added,
// then the replay cut, then filters.
// =====================================================================

export function GraphView({ data }: { data: GraphData }) {
  const router = useRouter();
  const { settings, update, reset } = useGraphSettings(GLOBAL_GRAPH_SETTINGS_KEY);
  const replay = useReplay(data.nodes);
  const { showRelated, relatedness } = settings.filters;

  // Related links come from the full graph, so the replay grows them with their units
  const related = useMemo(() => withRelated(data, { show: showRelated, threshold: relatedness }), [data, showRelated, relatedness]);

  const visible = useMemo(() => {
    const grown = replay.cutoff === null ? related : createdBy(related, replay.cutoff);
    return applyFilters(grown, settings.filters);
  }, [related, replay.cutoff, settings.filters]);

  return (
    <div className="relative h-full">
      <GraphCanvas graph={visible} settings={settings} onOpen={(node) => router.push(node.href)} />
      <GraphPanel
        settings={settings}
        update={update}
        reset={reset}
        isReplaying={replay.isPlaying}
        onAnimate={replay.isPlaying ? replay.stop : replay.start}
      />
      <p className="pointer-events-none absolute right-3 bottom-2 font-mono text-xs text-faint">
        {visible.nodes.length} nodes · {visible.links.length} links
      </p>
    </div>
  );
}
