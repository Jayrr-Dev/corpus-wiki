"use client";

import { useServerAction } from "@/components/actions/useServerAction";
import { InfoPopover } from "@/components/standard/info-popover";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  applyFilters,
  createdBy,
  DEFAULT_GRAPH_SETTINGS,
  graphForGrouping,
  pageDropLabel,
  withRelated,
  type CircleOpenTarget,
  type GraphData,
  type GraphNode,
  type GraphSettings,
  type PageDrop,
} from "@/lib/graph";
import { queryKeys } from "@/lib/queries";
import {
  moveGraphClaim,
  moveGraphUnitToGroup,
} from "@/lib/server-actions/graphNodes";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DomainContextMenu } from "./DomainContextMenu";
import { GraphCanvas } from "./GraphCanvas";
import { NodeContextMenu } from "./NodeContextMenu";
import { CirclePreviewDialog } from "./NodePreviews";
import { GraphPanel } from "./panel/GraphPanel";
import { SelectionActions } from "./SelectionActions";
import { NodePreviewDialog } from "./UnitPreviewDialog";
import {
  GLOBAL_GRAPH_SETTINGS_KEY,
  useGraphSettings,
} from "./useGraphSettings";
import { useReplay } from "./useReplay";

const GRAPH_QUERY_KEY = [
  ...queryKeys.table("units"),
  "graph",
  "suggestions",
] as const;

type PendingMove =
  | { mode: "domain"; node: GraphNode; source: string; destination: string }
  | { mode: "page"; node: GraphNode; drop: PageDrop };

// Move the claim in the cached graph so the canvas updates before the server round-trip finishes.
function withMovedClaim(
  data: GraphData,
  unitId: string,
  source: string,
  destination: string,
): GraphData {
  return {
    ...data,
    nodes: data.nodes.map((node) => {
      if (node.id !== unitId) return node;
      const domainPaths = [
        ...new Set([
          ...node.domainPaths.filter((path) => path !== source),
          destination,
        ]),
      ];
      const scopes = node.domainScopePaths;
      return {
        ...node,
        domainPaths,
        domainScopePaths: scopes
          ? {
              internal: scopes.internal.length ? domainPaths : [],
              external: scopes.external.length ? domainPaths : [],
            }
          : scopes,
      };
    }),
  };
}

// Page grouping: the claim leaves its article and sits in the group it was dropped on.
function withMovedToGroup(
  data: GraphData,
  unitId: string,
  drop: PageDrop,
): GraphData {
  return {
    ...data,
    nodes: data.nodes.map((node) => {
      if (node.id !== unitId) return node;
      if (drop.kind === "suggestion") {
        return {
          ...node,
          pageTitles: [],
          pageSections: [],
          recommendedTitle: drop.title,
          recommendedKind: drop.merge ? "merge" : "create",
        };
      }
      const page = drop.page;
      return {
        ...node,
        pageTitles: [page],
        pageSections:
          drop.kind === "section"
            ? [{ page, section: drop.section, position: 0 }]
            : [],
        recommendedTitle: undefined,
        recommendedKind: undefined,
      };
    }),
  };
}

// =====================================================================
// GRAPH VIEW (global): the whole knowledge graph on a canvas, with the
// floating settings panel. What shows = derived "similar" links added,
// then the replay cut, then filters.
// =====================================================================

export function GraphView({
  data,
  actions,
}: {
  data: GraphData;
  actions?:
    | ReactNode
    | ((settings: GraphSettings, focusedDomain: string | null) => ReactNode);
}) {
  const { settings, update, reset } = useGraphSettings(
    GLOBAL_GRAPH_SETTINGS_KEY,
    data.nodes,
  );
  const [focusedDomain, setFocusedDomain] = useState<{
    path: string | null;
    filter: string;
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  useEffect(() => {
    const clear = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedIds([]);
    };
    window.addEventListener("keydown", clear);
    return () => window.removeEventListener("keydown", clear);
  }, []);
  const [domainVersion, setDomainVersion] = useState(0);
  const [domainContext, setDomainContext] = useState<{
    path: string;
    x: number;
    y: number;
  } | null>(null);
  const [context, setContext] = useState<{
    node: GraphNode;
    x: number;
    y: number;
  } | null>(null);
  const replay = useReplay(data.nodes);
  // Every node previews without leaving the graph.
  const [preview, setPreview] = useState<GraphNode | null>(null);
  const [openedCircle, setOpenedCircle] = useState<CircleOpenTarget | null>(
    null,
  );
  // Dropping a claim onto a domain asks before filing it.
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  // Skip the full-table refresh: the graph is patched locally, then units reconcile in the background.
  const move = useServerAction(moveGraphClaim, {
    progress: {
      title: "Moving claim",
      detail: "Filing it in the domain you dropped it on.",
      delayMs: 800,
    },
    refreshTables: [],
  });
  const pageMove = useServerAction(moveGraphUnitToGroup, {
    progress: {
      title: "Moving knowledge",
      detail: "Putting it in the group you dropped it on.",
      delayMs: 800,
    },
    refreshTables: [],
  });
  const busy = move.isPending || pageMove.isPending;
  const moveNode = useCallback(
    (node: GraphNode, destination: string | PageDrop) => {
      if (node.kind !== "unit" || busy) return;
      setMoveError(null);
      if (typeof destination === "string") {
        const source = [...node.domainPaths].sort()[0] ?? "";
        if (!destination || destination === source) return;
        setPendingMove({ mode: "domain", node, source, destination });
        return;
      }
      setPendingMove({ mode: "page", node, drop: destination });
    },
    [busy],
  );
  const confirmMove = useCallback(async () => {
    if (!pendingMove || busy) return;
    setPendingMove(null);
    setMoveError(null);
    if (pendingMove.mode === "domain") {
      const { node, source, destination } = pendingMove;
      queryClient.setQueryData<GraphData>(GRAPH_QUERY_KEY, (current) =>
        current
          ? withMovedClaim(current, node.id, source, destination)
          : current,
      );
      const result = await move.run(node.id, source, destination);
      if (!result.ok) {
        setMoveError(result.error);
        void queryClient.invalidateQueries({
          queryKey: queryKeys.table("units"),
        });
        return;
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.table("units"),
      });
      return;
    }
    const { node, drop } = pendingMove;
    queryClient.setQueryData<GraphData>(GRAPH_QUERY_KEY, (current) =>
      current ? withMovedToGroup(current, node.id, drop) : current,
    );
    const result = await pageMove.run(node.id, drop);
    void queryClient.invalidateQueries({ queryKey: queryKeys.table("units") });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.table("article_suggestions"),
    });
    if (!result.ok) setMoveError(result.error);
  }, [pendingMove, busy, move, pageMove, queryClient]);
  const { showRelated, relatedness } = settings.filters;

  // Related links come from the full graph, so the replay grows them with their units
  const related = useMemo(
    () => withRelated(data, { show: showRelated, threshold: relatedness }),
    [data, showRelated, relatedness],
  );

  const visible = useMemo(() => {
    const grown =
      replay.cutoff === null ? related : createdBy(related, replay.cutoff);
    // Entity dots and their connecting lines are gone. An entity is a circle in the Entities group.
    const filtered = applyFilters(grown, settings.filters);
    return graphForGrouping(filtered, settings.display.groupBy);
  }, [related, replay.cutoff, settings.display.groupBy, settings.filters]);

  return (
    <div className="relative h-full">
      <GraphCanvas
        key={`${settings.filters.domain}:${domainVersion}`}
        graph={visible}
        settings={settings}
        onOpen={setPreview}
        onContextDomain={(path, point) => setDomainContext({ path, ...point })}
        selectedIds={selectedIds}
        onSelect={(nodes, toggle) =>
          setSelectedIds((previous) => {
            const ids = nodes.filter((n) => n.kind === "unit").map((n) => n.id);
            return toggle
              ? [
                  ...previous.filter((id) => !ids.includes(id)),
                  ...ids.filter((id) => !previous.includes(id)),
                ]
              : ids;
          })
        }
        onFocusDomain={(path) =>
          setFocusedDomain({ path, filter: settings.filters.domain })
        }
        onOpenCircle={setOpenedCircle}
        onContextNode={(node, point) => setContext({ node, ...point })}
        onMoveNode={moveNode}
      />
      {visible.nodes.length === 0 && data.nodes.length > 0 && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center pl-64 pr-4"
          role="status"
        >
          <div className="pointer-events-auto flex max-w-sm flex-col items-center gap-3 rounded-lg border bg-background p-6 text-center shadow-sm">
            <p className="font-medium">No nodes match the current filters</p>
            <p className="text-sm text-muted-foreground">
              Your graph has {data.nodes.length} nodes. Try including both
              internal and external domains or clearing your filters.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                replay.stop();
                update("filters", {
                  ...DEFAULT_GRAPH_SETTINGS.filters,
                  domainScope: "both",
                  showEntities: true,
                  showDomains: true,
                  showPages: true,
                });
              }}
            >
              Show all nodes
            </Button>
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
        actions={
          typeof actions === "function"
            ? actions(
                settings,
                (focusedDomain?.filter === settings.filters.domain
                  ? focusedDomain.path
                  : null) ??
                  (settings.filters.domain || null),
              )
            : actions
        }
      />
      {moveError ? (
        <p
          role="alert"
          className="absolute bottom-8 left-3 z-20 max-w-sm rounded-md border bg-background px-3 py-2 text-sm shadow-md"
        >
          {moveError}
        </p>
      ) : null}
      <p className="pointer-events-none absolute right-3 bottom-2 font-mono text-xs text-faint">
        {visible.nodes.length} nodes · {visible.links.length} links
      </p>
      <SelectionActions
        nodes={visible.nodes.filter((n) => selectedIds.includes(n.id))}
        onClear={() => setSelectedIds([])}
      />
      <DomainContextMenu
        context={domainContext}
        onClose={() => setDomainContext(null)}
        onChanged={() => {
          setFocusedDomain(null);
          setDomainVersion((v) => v + 1);
          update("filters", { ...settings.filters, domain: "" });
        }}
      />
      <NodeContextMenu
        context={context}
        data={data}
        onClose={() => setContext(null)}
        onOpen={setPreview}
      />
      <NodePreviewDialog
        node={preview}
        units={data.nodes}
        onClose={() => setPreview(null)}
      />
      <CirclePreviewDialog
        target={openedCircle}
        pages={data.nodes}
        units={data.nodes}
        onClose={() => setOpenedCircle(null)}
      />
      <Dialog
        open={pendingMove !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setPendingMove(null);
        }}
      >
        <DialogContent>
          {pendingMove ? (
            <>
              <DialogHeader>
                <div className="flex items-center gap-1.5">
                  <DialogTitle>Move this knowledge?</DialogTitle>
                  <InfoPopover label="About moving knowledge">
                    {pendingMove.mode === "domain" ? (
                      <>
                        <p>Confirm the domain you dropped this claim into.</p>
                        <ul className="mt-2 list-disc space-y-1 pl-4">
                          <li>Other domain memberships stay intact.</li>
                          <li>Undo this move in Changes.</li>
                        </ul>
                      </>
                    ) : (
                      <>
                        <p>
                          Confirm the group you dropped this knowledge into.
                        </p>
                        <ul className="mt-2 list-disc space-y-1 pl-4">
                          <li>
                            An article or section is rewritten so it includes
                            this knowledge.
                          </li>
                          <li>It leaves the section that cited it.</li>
                          <li>
                            A suggestion adds it to that new article or merge.
                            Accept the suggestion before it is written.
                          </li>
                          <li>Undo a finished section move in Changes.</li>
                        </ul>
                      </>
                    )}
                  </InfoPopover>
                </div>
                <DialogDescription className="sr-only">
                  Confirm moving “{pendingMove.node.label}” into{" "}
                  {pendingMove.mode === "domain"
                    ? pendingMove.destination.split("/").at(-1) ||
                      pendingMove.destination
                    : pageDropLabel(pendingMove.drop)}
                  .
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 rounded-lg border bg-muted/60 px-3 py-2 text-sm font-semibold leading-relaxed break-words">
                  {pendingMove.node.label}
                </div>
                <span
                  className="shrink-0 text-muted-foreground"
                  aria-hidden="true"
                >
                  →
                </span>
                <div className="min-w-0 flex-1 rounded-lg border border-link/30 bg-link/10 px-3 py-2 text-sm font-semibold leading-relaxed break-words text-link">
                  {pendingMove.mode === "domain"
                    ? pendingMove.destination.split("/").at(-1) ||
                      pendingMove.destination
                    : pageDropLabel(pendingMove.drop)}
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="ghost">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="button" onClick={() => void confirmMove()}>
                  {pendingMove.mode === "page" &&
                  pendingMove.drop.kind === "suggestion"
                    ? "Add"
                    : "Move"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
