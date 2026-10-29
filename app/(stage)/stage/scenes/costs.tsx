"use client";
/* eslint-disable shadcn/no-inline-styles -- stage frames compute every position, scale and opacity from t */

import { useLayoutEffect, type ReactNode } from "react";
import { BrainCircuit, Bot, ChartNoAxesCombined, CircleDollarSign, Gauge, LockKeyhole, SlidersHorizontal, ToggleRight, type LucideIcon } from "lucide-react";
import type { QueryClient } from "@tanstack/react-query";
import { SettingsTabs } from "@/app/(app)/settings/SettingsTabs";
import { CostTable } from "@/components/usage/CostTable";
import { Camera, Cursor, Highlight, hovered, StageProviders, StageShell, type Scene } from "@/components/video-stage";
import { DEFAULT_AI_MODEL } from "@/lib/ai/config";
import { aiCalls } from "@/lib/video-stage/phoenix/control";
import { ORIGIN, useElementStyle, useFrameRects } from "./exception";

// =====================================================================
// SETTINGS FRAME (shared with the picker scene): the Settings page's tab
// bar and card (settings/page.tsx, a server page), with one tab open.
// The tab opens with a click on it before the first frame is painted.
// =====================================================================

const SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
  { id: "intelligence", label: "Intelligence", icon: BrainCircuit },
  { id: "features", label: "Features", icon: ToggleRight },
  { id: "security", label: "Security", icon: LockKeyhole },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "usage", label: "Usage & activity", icon: ChartNoAxesCombined },
  { id: "costs", label: "AI costs", icon: CircleDollarSign },
  { id: "speed", label: "AI Speed", icon: Gauge },
];

export function SettingsFrame({ tab, title, description, children }: { tab: string; title: string; description: string; children: ReactNode }) {
  // Opens the tab with its own button before the first paint (SettingsTabs keeps the choice in its state)
  useLayoutEffect(() => document.getElementById(`${tab}-tab`)?.click(), [tab]);
  const section = SECTIONS.find((entry) => entry.id === tab)!;
  const Icon = section.icon;
  const card = (
    <section id={tab} aria-labelledby={`${tab}-title`} className="min-w-0 rounded-2xl border bg-background shadow-sm">
      <header className="flex items-start gap-3 border-b px-5 py-5 sm:px-6">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border bg-sidebar text-muted-foreground"><Icon size={17} aria-hidden="true" /></span>
        <div><h2 id={`${tab}-title`} className="text-sm font-semibold">{title}</h2><p className="mt-1 text-panel text-muted-foreground">{description}</p></div>
      </header>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
  return (
    <StageShell title="Settings">
      <div className="mt-2">
        <SettingsTabs tabs={SECTIONS.map(({ id, label, icon: TabIcon }) => ({ id, label, icon: <TabIcon size={16} aria-hidden="true" />, panel: id === tab ? card : null }))} />
      </div>
    </StageShell>
  );
}

// =====================================================================
// COSTS: "Each step gets the cheapest model that does its job well…"
// Settings, AI costs: Token Factory prices beside this quarter's calls.
// The cursor settles on Nemotron Nano, the cheapest, which also does the
// most calls. 3.6 seconds.
// =====================================================================

const NANO = "NVIDIA-Nemotron-3-Nano-30B-A3B";
const REST = 1.1;

function seed(qc: QueryClient) {
  qc.setQueryData(["table", "ai_calls", "all"], aiCalls());
}

const nanoRow = (root: ParentNode) => [...root.querySelectorAll("tr")].find((row) => row.querySelector("td")?.textContent?.trim().startsWith(NANO));

function Costs({ t }: { t: number }) {
  const [origin, rects] = useFrameRects((frame) => {
    const row = nanoRow(frame);
    return { row, price: row?.querySelectorAll("td")[1] };
  });
  useElementStyle(() => nanoRow(document), { ...hovered(t, REST - 0.1, 9), backgroundColor: t >= REST - 0.1 ? "var(--color-hover)" : "" });
  const row = rects.row ?? { x: 400, y: 500, w: 1100, h: 40, cx: 950, cy: 520 };
  const price = rects.price ?? { cx: 900, cy: 520 };
  return (
    <StageProviders seed={seed}>
      <Camera t={t} keys={[[0, 1, price.cx, row.cy], [3.6, 1.14, price.cx, row.cy]]}>
        <div ref={origin} style={ORIGIN} />
        <SettingsFrame tab="costs" title="AI costs" description="What each model costs per million tokens, and what you've spent.">
          <CostTable activeModel={DEFAULT_AI_MODEL} />
        </SettingsFrame>
        <Highlight t={t} from={REST + 0.15} to={4} x={row.x} y={row.y} w={row.w} h={row.h} radius={6} />
        <Cursor t={t} path={[[0, price.cx + 420, row.cy + 260], [0.15, price.cx + 410, row.cy + 250], [REST, price.cx - 10, row.cy + 6], [3.6, price.cx - 4, row.cy + 8]]} />
      </Camera>
    </StageProviders>
  );
}

export const costs: Scene = { duration: 3.6, Component: Costs, title: "AI costs" };
