"use client";

import { useSyncExternalStore } from "react";

// =====================================================================
// TUTORIAL DISMISSED: remembered per browser in localStorage. A
// convenience only: when storage is blocked the card just shows again.
// Read through useSyncExternalStore, so the server render (no storage)
// hides the card and the browser shows it once it knows.
// =====================================================================

const STORAGE_KEY = "second-brain:tutorial-dismissed";
const listeners = new Set<() => void>();
// Fallback when storage is blocked, so Close still works until the page reloads
let memoryDismissed = false;

// The remembered choice and a setter that saves it
export function useTutorialDismissed(): [boolean, (dismissed: boolean) => void] {
  const isDismissed = useSyncExternalStore(subscribe, readDismissed, () => true);
  return [isDismissed, writeDismissed];
}

// Re-reads on this tab's writes and on other tabs' storage events
function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

// Remembered choice; the in-memory one when storage is unavailable
function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return memoryDismissed;
  }
}

// Saves the choice when storage allows it, then tells the open cards
function writeDismissed(dismissed: boolean): void {
  memoryDismissed = dismissed;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(dismissed));
  } catch {
    // Storage blocked (private window): the choice lasts until the page reloads
  }
  for (const listener of listeners) listener();
}
