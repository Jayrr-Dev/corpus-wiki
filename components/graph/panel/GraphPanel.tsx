"use client";

import { UndoIcon } from "@/components/icons";
import type { GraphSettings } from "@/lib/graph";
import type { UpdateGraphSettings } from "../useGraphSettings";
import { DisplaySection, FiltersSection, ForcesSection, GroupsSection } from "./sections";

interface GraphPanelProps {
  settings: GraphSettings;
  update: UpdateGraphSettings;
  reset: () => void;
  isReplaying: boolean;
  onAnimate: () => void;
}

// GRAPH PANEL: the floating settings card, top-left over the canvas (Obsidian's layout)
export function GraphPanel({ settings, update, reset, isReplaying, onAnimate }: GraphPanelProps) {
  return (
    <aside
      aria-label="Graph settings"
      className="absolute top-3 left-3 flex max-h-[calc(100%-1.5rem)] w-60 flex-col overflow-y-auto rounded-lg border bg-sidebar/95 px-3 py-1 shadow-sm backdrop-blur"
    >
      <div className="flex justify-end pt-1">
        <button type="button" aria-label="Restore default settings" title="Restore default settings" onClick={reset} className="text-faint hover:text-text">
          <UndoIcon size={14} />
        </button>
      </div>
      <FiltersSection value={settings.filters} onChange={(next) => update("filters", next)} />
      <GroupsSection value={settings.groups} onChange={(next) => update("groups", next)} />
      <DisplaySection value={settings.display} onChange={(next) => update("display", next)} isReplaying={isReplaying} onAnimate={onAnimate} />
      <ForcesSection value={settings.forces} onChange={(next) => update("forces", next)} />
    </aside>
  );
}
