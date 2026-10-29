"use client";

import { useSyncExternalStore } from "react";

// NAV MODE: "admin" shows every module; "user" keeps the sidebar to the reading places.
// A view preference only (kept in this browser), not a permission: every page still opens by URL.
export type NavMode = "admin" | "user";

const KEY = "corpus.navMode";
const listeners = new Set<() => void>();

function read(): NavMode {
  try { return localStorage.getItem(KEY) === "user" ? "user" : "admin"; } catch { return "admin"; }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => { if (event.key === KEY) listener(); };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}

export function setNavMode(mode: NavMode) {
  try { localStorage.setItem(KEY, mode); } catch { /* storage may be disabled */ }
  listeners.forEach((listener) => listener());
}

// The server renders admin, so the first paint matches before storage is read
export function useNavMode(): NavMode {
  return useSyncExternalStore(subscribe, read, () => "admin");
}

// Admin controls (add, edit, delete) show only in Admin mode
export function useIsAdminMode(): boolean {
  return useNavMode() === "admin";
}
