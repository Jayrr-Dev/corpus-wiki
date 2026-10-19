"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_GRAPH_SETTINGS, type GraphSettings } from "@/lib/graph";
import { useActiveSpace } from "@/components/shell/SpaceProvider";
import { graphSettingsStorageKey, loadGraphSettings } from "@/lib/graph/settingsStorage";
import { withDomainColorGroups } from "@/lib/graph/settings";
import type { GraphNode } from "@/lib/graph/types";

// =====================================================================
// GRAPH SETTINGS STATE: the panel's values, kept per view in the
// browser so they survive a reload. Storage can be missing or blocked
// (private windows), so every read and write is allowed to fail.
// =====================================================================

// STORAGE KEYS: the global view's settings are shared with the local graph
export const GLOBAL_GRAPH_SETTINGS_KEY = "graph:global";

// Reads saved settings, or the defaults
function loadSettings(key: string): GraphSettings {
  try {
    return loadGraphSettings(window.localStorage, key);
  } catch {
    return DEFAULT_GRAPH_SETTINGS;
  }
}

// Saves settings; a failed write only means they will not survive a reload
function saveSettings(key: string, settings: GraphSettings): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(settings));
  } catch {
    // Storage unavailable: keep working with in-memory settings
  }
}

export type UpdateGraphSettings = <K extends keyof GraphSettings>(section: K, value: GraphSettings[K]) => void;

// Settings for one view, plus an updater per section and a reset
const EMPTY_NODES: readonly GraphNode[] = [];

export function useGraphSettings(key: string, nodes: readonly GraphNode[] = EMPTY_NODES) {
  const space = useActiveSpace();
  const storageKey = graphSettingsStorageKey(key, space.id);
  // LOAD once. The server has no storage and renders defaults; the graph only draws on the
  // client after its data loads, so no server markup depends on these values.
  const [state, setState] = useState(() => ({
    key: storageKey,
    settings: typeof window === "undefined" ? DEFAULT_GRAPH_SETTINGS : loadSettings(storageKey),
  }));
  // Also handle a changed provider without relying on the layout remounting us.
  const savedSettings = state.key === storageKey ? state.settings : loadSettings(storageKey);
  const settings = useMemo(() => withDomainColorGroups(savedSettings, nodes), [savedSettings, nodes]);
  // Retain discoveries even when later data refreshes remove a domain's last node.
  if (state.key !== storageKey || settings !== savedSettings) setState({ key: storageKey, settings });

  // SAVE on every change
  useEffect(() => saveSettings(storageKey, settings), [storageKey, settings]);

  const update: UpdateGraphSettings = useCallback((section, value) => {
    setState((current) => ({ key: storageKey, settings: {
      ...withDomainColorGroups(current.key === storageKey ? current.settings : loadSettings(storageKey), nodes),
      [section]: value,
    } }));
  }, [nodes, storageKey]);
  const reset = useCallback(() => setState({ key: storageKey, settings: DEFAULT_GRAPH_SETTINGS }), [storageKey]);

  return { settings, update, reset };
}
