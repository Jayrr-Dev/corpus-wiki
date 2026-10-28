"use client";

import { ErrorBoundary } from "@/components/error";
import { UndoIcon } from "@/components/icons";
import { Tooltip } from "@/components/standard/tooltip";
import type { GraphNode, GraphSettings } from "@/lib/graph";
import { Minus, Square } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { UpdateGraphSettings } from "../useGraphSettings";
import {
  EdgesSection,
  FiltersSection,
  GroupSection,
  GroupsSection,
  NodesSection,
  TuningSection,
  ViewSection,
} from "./sections";

interface GraphPanelProps {
  settings: GraphSettings;
  // The full graph's nodes: group suggestions and counts come from them
  nodes: readonly GraphNode[];
  update: UpdateGraphSettings;
  reset: () => void;
  isReplaying: boolean;
  onAnimate: () => void;
  actions?: ReactNode;
}

// GRAPH PANEL: the floating settings card, top-left over the canvas (Obsidian's layout);
// minimizing hides it and leaves a bare outlined square to reopen it
export function GraphPanel({
  settings,
  nodes,
  update,
  reset,
  isReplaying,
  onAnimate,
  actions,
}: GraphPanelProps) {
  const [minimized, setMinimized] = useState(false);
  if (minimized) {
    return (
      <Tooltip content="Expand graph settings" side="right">
        <button
          type="button"
          onClick={() => setMinimized(false)}
          aria-label="Expand graph settings"
          className="absolute top-3 left-3 text-faint hover:text-foreground"
        >
          <Square className="size-4" />
        </button>
      </Tooltip>
    );
  }
  return (
    <aside
      aria-label="Graph settings"
      className="absolute top-3 left-3 flex max-h-[calc(100%-1.5rem)] w-60 flex-col overflow-y-auto rounded-lg border bg-sidebar/95 px-3 py-1 shadow-sm backdrop-blur"
    >
      <div className="flex items-center justify-end gap-1 pt-1">
        <Tooltip content="Restore default settings">
          <button
            type="button"
            aria-label="Restore default settings"
            onClick={reset}
            className="text-faint hover:text-text"
          >
            <UndoIcon size={14} />
          </button>
        </Tooltip>
        <Tooltip content="Minimize">
          <button
            type="button"
            aria-label="Minimize graph settings"
            onClick={() => setMinimized(true)}
            className="flex size-5 items-center justify-center text-faint hover:text-text"
          >
            <Minus className="size-3.5" />
          </button>
        </Tooltip>
      </div>
      <ErrorBoundary where="The Filters section">
        <FiltersSection
          value={settings.filters}
          nodes={nodes}
          onChange={(next) => update("filters", next)}
        />
      </ErrorBoundary>
      <ErrorBoundary where="The View section">
        <ViewSection
          value={settings.display}
          onChange={(next) => update("display", next)}
        />
      </ErrorBoundary>
      <ErrorBoundary where="The Nodes section">
        <NodesSection
          value={settings.filters}
          onChange={(next) => update("filters", next)}
        />
      </ErrorBoundary>
      <ErrorBoundary where="The Edges section">
        <EdgesSection
          value={settings.filters}
          display={settings.display}
          onChange={(next) => update("filters", next)}
          onDisplayChange={(next) => update("display", next)}
        />
      </ErrorBoundary>
      <ErrorBoundary where="The Group section">
        <GroupSection
          value={settings.display}
          onChange={(next) => update("display", next)}
        />
      </ErrorBoundary>
      <ErrorBoundary where="The Groups section">
        <GroupsSection
          value={settings.groups}
          nodes={nodes}
          onChange={(next) => update("groups", next)}
        />
      </ErrorBoundary>
      <ErrorBoundary where="The Tuning section">
        <TuningSection
          filters={settings.filters}
          display={settings.display}
          forces={settings.forces}
          onFiltersChange={(next) => update("filters", next)}
          onDisplayChange={(next) => update("display", next)}
          onForcesChange={(next) => update("forces", next)}
          isReplaying={isReplaying}
          onAnimate={onAnimate}
          actions={actions}
        />
      </ErrorBoundary>
    </aside>
  );
}
