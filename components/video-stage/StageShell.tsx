"use client";

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { AppShell } from "@/components/shell";
import { ReadingPane } from "@/components/shell/ReadingPane";
import { enabledModuleFlags, defaultFeatureFlags, type ModuleFlagKey } from "@/lib/flags/registry";
import { PHOENIX_ACCOUNT, PHOENIX_SPACE } from "@/lib/video-stage/phoenix/core";

// The sidebar's badge reads, which run behind every screen. Seeded empty (no badge)
// unless the scene's own seed already set them, e.g. to show "3" on Decisions.
export function seedShellBadges(qc: QueryClient, spaceId = PHOENIX_SPACE.id) {
  const defaults: [readonly unknown[], unknown][] = [
    [["table", "exceptions", "open-count", spaceId], 0],
    [["table", "article_suggestions", "attention", spaceId], 0],
    [["table", "sources", "active-internal-ids"], []],
    [["table", "shift_events", "upload-runs"], []],
  ];
  for (const [key, value] of defaults) if (qc.getQueryData(key) === undefined) qc.setQueryData(key, value);
}

const DEFAULT_MODULES = enabledModuleFlags(defaultFeatureFlags());

export type StageShellProps = {
  // with a title the children sit in the app's ReadingPane; without one they fill the pane as they are
  title?: string;
  width?: "prose" | "wide" | "full";
  actions?: ReactNode;
  modules?: readonly ModuleFlagKey[];
  children?: ReactNode;
};

// STAGE SHELL: the real AppShell (sidebar, reading pane, right panel) as Bill Palmer in Parts Unlimited.
// Use inside StageProviders.
export function StageShell({ title, width = "wide", actions, modules = DEFAULT_MODULES, children }: StageShellProps) {
  const qc = useQueryClient();
  useState(() => seedShellBadges(qc));
  return (
    <AppShell defaultOpen spaces={[PHOENIX_SPACE]} activeSpace={PHOENIX_SPACE} account={PHOENIX_ACCOUNT} modules={modules}>
      {title ? <ReadingPane title={title} width={width} actions={actions}>{children}</ReadingPane> : children}
    </AppShell>
  );
}
