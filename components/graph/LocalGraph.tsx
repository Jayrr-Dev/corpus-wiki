"use client";

import { useMemo, useState } from "react";
import { applyFilters, neighborhood, useGraphData, withRelated, type GraphNode, type GraphSettings } from "@/lib/graph";
import { GraphCanvas } from "./GraphCanvas";
import { SliderRow } from "./panel/rows";
import { GLOBAL_GRAPH_SETTINGS_KEY, useGraphSettings } from "./useGraphSettings";

// =====================================================================
// LOCAL GRAPH: one item and its neighbors, for the right panel. Uses
// the global view's layers, groups, display and forces, so both views
// look the same; only the depth is its own. Search and the orphan
// filter do not apply (the center is always shown).
// =====================================================================

// DEPTH RANGE: links away from the center
const MIN_DEPTH = 1;
const MAX_DEPTH = 5;

export function LocalGraph({ centerId }: { centerId: string }) {
  const [preview, setPreview] = useState<GraphNode | null>(null);
  const query = useGraphData();
  const { settings } = useGraphSettings(GLOBAL_GRAPH_SETTINGS_KEY, query.data?.nodes);
  const [depth, setDepth] = useState(MIN_DEPTH);

  const local = useMemo(() => {
    if (!query.data) return null;
    // The center's own layer is always on (an entity's local graph shows the entity)
    const centerKind = query.data.nodes.find((node) => node.id === centerId)?.kind;
    const related = withRelated(query.data, { show: settings.filters.showRelated, threshold: settings.filters.relatedness });
    const layers = applyFilters(related, {
      ...settings.filters,
      search: "",
      domain: "",
      showOrphans: true,
      showUnits: settings.filters.showUnits || centerKind === "unit",
      showEntities: settings.filters.showEntities || centerKind === "entity",
      showPages: settings.filters.showPages || centerKind === "page",
    });
    return neighborhood(layers, centerId, depth);
  }, [query.data, settings.filters, centerId, depth]);
  // The main graph can group by entity. This small graph stays on topic circles.
  const localSettings = useMemo((): Pick<GraphSettings, "display" | "forces" | "groups"> => ({
    ...settings,
    display: { ...settings.display, groupBy: settings.display.groupBy === "off" ? "off" : "domain" },
  }), [settings]);

  return (
    <section aria-label="Local graph" className="flex flex-col gap-2">
      <h2 className="text-xs font-medium tracking-wide text-faint uppercase">Local graph</h2>
      <div className="h-64 overflow-hidden rounded-md border">
        {local ? <GraphCanvas graph={local} settings={localSettings} progressiveZoom={false} hoverLabelOnly openNode={preview} onCloseNode={() => setPreview(null)} onOpen={setPreview} /> : null}
      </div>
      <SliderRow label={`Depth ${depth}`} value={depth} min={MIN_DEPTH} max={MAX_DEPTH} step={1} onChange={setDepth} />
    </section>
  );
}
