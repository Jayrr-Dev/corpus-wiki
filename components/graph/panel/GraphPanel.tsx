"use client";

import { useState, type ReactNode } from "react";
import { Minus, Square } from "lucide-react";
import { UndoIcon } from "@/components/icons";
import { Tooltip } from "@/components/standard/tooltip";
import type { GraphNode, GraphSettings } from "@/lib/graph";
import type { UpdateGraphSettings } from "../useGraphSettings";
import { PanelSection } from "./PanelSection";
import { DisplaySection, FiltersSection, ForcesSection, GroupsSection } from "./sections";

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
export function GraphPanel({ settings, nodes, update, reset, isReplaying, onAnimate, actions }: GraphPanelProps) {
  const [minimized, setMinimized] = useState(false);
  if (minimized) {
    return (
      <Tooltip content="Expand graph settings" side="right">
        <button type="button" onClick={() => setMinimized(false)} aria-label="Expand graph settings" className="absolute top-3 left-3 text-faint hover:text-foreground">
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
          <button type="button" aria-label="Restore default settings" onClick={reset} className="text-faint hover:text-text">
            <UndoIcon size={14} />
          </button>
        </Tooltip>
        <Tooltip content="Minimize">
          <button type="button" aria-label="Minimize graph settings" onClick={() => setMinimized(true)} className="flex size-5 items-center justify-center text-faint hover:text-text">
            <Minus className="size-3.5" />
          </button>
        </Tooltip>
      </div>
      {actions ? <PanelSection title="Actions" defaultOpen>{actions}</PanelSection> : null}
      <FiltersSection value={settings.filters} nodes={nodes} onChange={(next) => update("filters", next)} />
      <GroupsSection value={settings.groups} nodes={nodes} onChange={(next) => update("groups", next)} />
      <DisplaySection value={settings.display} onChange={(next) => update("display", next)} isReplaying={isReplaying} onAnimate={onAnimate} />
      <ForcesSection value={settings.forces} onChange={(next) => update("forces", next)} />
    </aside>
  );
}
