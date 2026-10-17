"use client";

import { DomainContextMenu } from "./DomainContextMenu";
import { SelectionActions } from "./SelectionActions";
import { NodeContextMenu } from "./NodeContextMenu";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { applyFilters, createdBy, DEFAULT_GRAPH_SETTINGS, withRelated, type GraphData, type GraphSettings, type GraphNode } from "@/lib/graph";
import { Button } from "@/components/ui/button";
import { GraphCanvas } from "./GraphCanvas";
import { GraphPanel } from "./panel/GraphPanel";
import { NodePreviewDialog } from "./UnitPreviewDialog";
import { GLOBAL_GRAPH_SETTINGS_KEY, useGraphSettings } from "./useGraphSettings";
import { useReplay } from "./useReplay";

// =====================================================================
// GRAPH VIEW (global): the whole knowledge graph on a canvas, with the
// floating settings panel. What shows = derived "similar" links added,
// then the replay cut, then filters.
// =====================================================================

export function GraphView({ data, actions }: { data: GraphData; actions?: ReactNode | ((settings: GraphSettings, focusedDomain: string | null) => ReactNode) }) {
  const { settings, update, reset } = useGraphSettings(GLOBAL_GRAPH_SETTINGS_KEY, data.nodes);
  const [focusedDomain, setFocusedDomain] = useState<{path:string|null;filter:string}|null>(null);
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
  useEffect(()=>{const clear=(event:KeyboardEvent)=>{if(event.key==="Escape")setSelectedIds([]);};window.addEventListener("keydown",clear);return ()=>window.removeEventListener("keydown",clear);},[]);
  const [domainVersion,setDomainVersion]=useState(0);
  const [domainContext,setDomainContext]=useState<{path:string;x:number;y:number}|null>(null);
  const [context, setContext] = useState<{node: GraphNode; x:number; y:number} | null>(null);
  const replay = useReplay(data.nodes);
  // Every node previews without leaving the graph.
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
      <GraphCanvas key={`${settings.filters.domain}:${domainVersion}`} graph={visible} settings={settings} onOpen={setPreview} onContextDomain={(path,point)=>setDomainContext({path,...point})} selectedIds={selectedIds} onSelect={(nodes,toggle)=>setSelectedIds(previous=>{const ids=nodes.filter(n=>n.kind==="unit").map(n=>n.id);return toggle ? [...previous.filter(id=>!ids.includes(id)),...ids.filter(id=>!previous.includes(id))] : ids;})} onFocusDomain={path => setFocusedDomain({path,filter:settings.filters.domain})} onContextNode={(node, point) => setContext({node,...point})} />
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
        actions={typeof actions === "function" ? actions(settings, (focusedDomain?.filter === settings.filters.domain ? focusedDomain.path : null) ?? (settings.filters.domain || null)) : actions}
      />
      <p className="pointer-events-none absolute right-3 bottom-2 font-mono text-xs text-faint">
        {visible.nodes.length} nodes · {visible.links.length} links
      </p>
      <SelectionActions nodes={visible.nodes.filter(n=>selectedIds.includes(n.id))} onClear={()=>setSelectedIds([])} />
      <DomainContextMenu context={domainContext} onClose={()=>setDomainContext(null)} onChanged={()=>{setFocusedDomain(null);setDomainVersion(v=>v+1);update("filters",{...settings.filters,domain:""});}} />
      <NodeContextMenu context={context} data={data} onClose={() => setContext(null)} onOpen={setPreview} />
      <NodePreviewDialog node={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
