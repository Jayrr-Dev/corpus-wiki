"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_GRAPH_SETTINGS, type GraphSettings, parseSavedSettings } from "@/lib/graph";

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
    const raw = window.localStorage.getItem(key);
    return raw ? parseSavedSettings(JSON.parse(raw)) : DEFAULT_GRAPH_SETTINGS;
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
export function useGraphSettings(key: string) {
  // LOAD once. The server has no storage and renders defaults; the graph only draws on the
  // client after its data loads, so no server markup depends on these values.
  const [settings, setSettings] = useState<GraphSettings>(() =>
    typeof window === "undefined" ? DEFAULT_GRAPH_SETTINGS : loadSettings(key),
  );

  // SAVE on every change
  useEffect(() => saveSettings(key, settings), [key, settings]);

  const update: UpdateGraphSettings = useCallback((section, value) => {
    setSettings((current) => ({ ...current, [section]: value }));
  }, []);
  const reset = useCallback(() => setSettings(DEFAULT_GRAPH_SETTINGS), []);

  return { settings, update, reset };
}
