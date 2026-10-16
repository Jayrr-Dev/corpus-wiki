"use client";

import { useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";

export type SettingsTab = { id: string; label: string; icon: ReactNode; panel: ReactNode };

// The URL hash ("#usage" -> "usage"), so deep links open their tab
function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}
const readHash = () => window.location.hash.slice(1);
const readNoHash = () => "";

export function SettingsTabs({ tabs }: { tabs: SettingsTab[] }) {
  const hash = useSyncExternalStore(subscribeHash, readHash, readNoHash);
  const [chosen, setChosen] = useState<string | null>(null);
  const active = chosen ?? (tabs.some((tab) => tab.id === hash) ? hash : tabs[0]?.id);

  function select(id: string) {
    setChosen(id);
    window.history.replaceState(null, "", `#${id}`);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.id === active);
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const next = tabs[(index + step + tabs.length) % tabs.length];
    if (!step || !next) return;
    event.preventDefault();
    select(next.id);
    document.getElementById(`${next.id}-tab`)?.focus();
  }

  return (
    <div className="grid gap-6">
      <div data-tour="settings-tabs" role="tablist" aria-label="Settings sections" onKeyDown={onKeyDown} className="flex gap-1 overflow-x-auto overflow-y-hidden border-b">
        {tabs.map(({ id, label, icon }) => {
          const selected = id === active;
          return (
            <button
              key={id}
              id={`${id}-tab`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${id}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(id)}
              className={`flex shrink-0 items-center gap-2.5 border-b-2 px-3 py-2.5 text-panel transition-colors ${selected ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {icon}{label}
            </button>
          );
        })}
      </div>
      {tabs.map(({ id, panel }) => (
        <div key={id} id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab`} hidden={id !== active} className="min-w-0">
          {panel}
        </div>
      ))}
    </div>
  );
}
