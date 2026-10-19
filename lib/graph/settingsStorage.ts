import { DEFAULT_GRAPH_SETTINGS, parseSavedSettings, type GraphSettings } from "./settings";

export function graphSettingsStorageKey(view: string, spaceId: string): string {
  return `${view}:space:${spaceId}`;
}

export function loadGraphSettings(storage: Pick<Storage, "getItem">, key: string): GraphSettings {
  try {
    const raw = storage.getItem(key);
    // Unscoped legacy settings have no reliable owner. Never copy them into a space.
    return raw ? parseSavedSettings(JSON.parse(raw)) : DEFAULT_GRAPH_SETTINGS;
  } catch {
    return DEFAULT_GRAPH_SETTINGS;
  }
}
