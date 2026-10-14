"use client";

import { useSyncExternalStore } from "react";
import { TUTORIAL_STEPS, type TutorialAction } from "./steps";

// =====================================================================
// TUTORIAL STATE: which step is showing, or that it was closed.
// Remembered per browser in localStorage; a convenience only, so when
// storage is blocked it lives in memory until the page reloads.
// Read through useSyncExternalStore: the server render (no storage)
// shows nothing, the browser shows the remembered state.
// =====================================================================

export type TutorialState = { isOpen: boolean; stepIndex: number };

const STORAGE_KEY = "second-brain:tutorial";
const FIRST_VISIT: TutorialState = { isOpen: true, stepIndex: 0 };
const SERVER_STATE: TutorialState = { isOpen: false, stepIndex: 0 };
const listeners = new Set<() => void>();
let memoryState = FIRST_VISIT;
let cached: { raw: string | null; state: TutorialState } | null = null;

// The current tutorial state, live
export function useTutorialState(): TutorialState {
  return useSyncExternalStore(subscribe, readState, () => SERVER_STATE);
}

// =====================================================================
// ACTIONS
// =====================================================================

// Shows one step (past the last one closes the tutorial)
export function goToStep(stepIndex: number): void {
  writeState(stepIndex >= TUTORIAL_STEPS.length ? { isOpen: false, stepIndex: 0 } : { isOpen: true, stepIndex: Math.max(0, stepIndex) });
}

// Closes the tutorial; it stays closed until reopened
export function closeTutorial(): void {
  writeState({ ...readState(), isOpen: false });
}

// Reopens at the first step
export function reopenTutorial(): void {
  writeState(FIRST_VISIT);
}

// A screen reports a completed action; the tour moves on when it was the current step's
export function reportTutorialAction(action: TutorialAction): void {
  const state = readState();
  if (state.isOpen && TUTORIAL_STEPS[state.stepIndex]?.completedBy === action) goToStep(state.stepIndex + 1);
}

// =====================================================================
// STORAGE
// =====================================================================

// Re-reads on this tab's writes and on other tabs' storage events
function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

// Stored state, the same object while the stored text is unchanged (useSyncExternalStore needs that)
function readState(): TutorialState {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return memoryState;
  }
  if (cached?.raw !== raw) cached = { raw, state: parseState(raw) };
  return cached.state;
}

// Parses stored text; anything unreadable starts the tour from the top
function parseState(raw: string | null): TutorialState {
  if (!raw) return FIRST_VISIT;
  try {
    const value = JSON.parse(raw) as Partial<TutorialState>;
    const stepIndex = Number.isInteger(value.stepIndex) ? Math.min(Number(value.stepIndex), TUTORIAL_STEPS.length - 1) : 0;
    return { isOpen: value.isOpen !== false, stepIndex: Math.max(0, stepIndex) };
  } catch {
    return FIRST_VISIT;
  }
}

// Saves the state when storage allows it, then tells every subscriber
function writeState(state: TutorialState): void {
  memoryState = state;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked (private window): memoryState carries it until reload
  }
  for (const listener of listeners) listener();
}
