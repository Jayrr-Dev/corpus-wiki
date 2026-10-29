"use client";
/* eslint-disable shadcn/no-inline-styles -- stage frames compute every position, scale and opacity from t */

import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { DateTime } from "@/app/(app)/_components/DateTime";
import { StatusDot } from "@/app/(app)/_components/StatusDot";
import { asObject, readString, readStrings } from "@/app/(app)/_lib/format";
import { CATEGORY_OF_REASON, CATEGORY_TABS } from "@/app/(app)/exceptions/categories";
import { ExceptionCard, exceptionTitle } from "@/app/(app)/exceptions/ExceptionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Camera, Cursor, Highlight, interaction, StageProviders, StageShell, type Scene } from "@/components/video-stage";
import { PHOENIX_SPACE } from "@/lib/video-stage/phoenix/core";
import { DEPLOY_ACTION, DEPLOY_EXCEPTION, DEPLOY_UNIT, EXCEPTION_COUNTS } from "@/lib/video-stage/phoenix/control";
import type { QueryClient } from "@tanstack/react-query";

// =====================================================================
// FRAME MEASURING (shared by the control lane's scenes): where real app
// elements sit in frame pixels, so the cursor, highlights and camera aim
// at them without hard-coded coordinates. Put <div ref={origin} style={ORIGIN} />
// inside the Camera; its size reveals the camera's current scale.
// =====================================================================

export type FrameRect = { x: number; y: number; w: number; h: number; cx: number; cy: number };
export const ORIGIN: CSSProperties = { position: "absolute", left: 0, top: 0, width: 1000, height: 1000, pointerEvents: "none", visibility: "hidden" };

// Measures after every render (layout effect, before paint) and re-renders only when a rect moved
export function useFrameRects(find: (frame: HTMLElement) => Record<string, Element | null | undefined>): [RefObject<HTMLDivElement | null>, Record<string, FrameRect>] {
  const origin = useRef<HTMLDivElement>(null);
  const [rects, setRects] = useState<Record<string, FrameRect>>({});
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-measures after every render on purpose
  useLayoutEffect(() => {
    const anchor = origin.current;
    const frame = anchor?.closest<HTMLElement>("[data-stage-frame]");
    if (!anchor || !frame) return;
    const o = anchor.getBoundingClientRect();
    const s = o.width / 1000;
    const next: Record<string, FrameRect> = {};
    for (const [key, element] of Object.entries(find(frame))) {
      if (!element) continue;
      const r = element.getBoundingClientRect();
      const x = (r.left - o.left) / s, y = (r.top - o.top) / s, w = r.width / s, h = r.height / s;
      next[key] = { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
    }
    const moved = Object.keys(next).length !== Object.keys(rects).length
      || Object.entries(next).some(([key, r]) => !rects[key] || Math.abs(rects[key].x - r.x) + Math.abs(rects[key].y - r.y) + Math.abs(rects[key].w - r.w) > 0.5);
    // Measuring the DOM after layout is what this effect is for; it settles once nothing moves
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (moved) setRects(next);
  });
  return [origin, rects];
}

// Styles a real element inside an app component from t (the component itself is never edited)
export function useElementStyle(element: () => HTMLElement | null | undefined, style: CSSProperties) {
  useLayoutEffect(() => {
    const target = element();
    if (target) Object.assign(target.style, style);
  });
}

// A button inside `root` by its exact text
export function buttonByText(root: ParentNode, text: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll("button")].find((button) => button.textContent?.trim() === text);
}

// =====================================================================
// EXCEPTION: "And if two files disagree… it asks you first." The
// Exceptions inbox with one conflict in Needs review: the runbook says
// every second Friday, April's CAB minutes say every Thursday after CAB.
// The cursor glides in, hovers Approve change and clicks it. 3.6 seconds.
// =====================================================================

const HOVER = 1.8;
const CLICK = 2.6;

function seed(qc: QueryClient) {
  qc.setQueryData(["table", "exceptions", "open-count", PHOENIX_SPACE.id], EXCEPTION_COUNTS.open);
}

// The inbox's own layout (ExceptionInbox.tsx), drawn with the one conflict selected; the inbox
// itself reads its rows through Supabase directly, so its markup is repeated here around the real card
function Inbox() {
  const row = { exception: DEPLOY_EXCEPTION, action: DEPLOY_ACTION };
  const evidence = asObject(row.exception.evidence);
  const proposal = asObject(row.action.input);
  const categoryLabel = CATEGORY_TABS.find((tab) => tab.id === CATEGORY_OF_REASON[row.exception.reason])?.label;
  const description = readString(proposal, "content");
  const domains = readStrings(evidence, "domainPaths");
  return <div className="flex flex-col gap-4">
    <p className="text-panel text-muted-foreground">Review proposed changes one at a time.</p>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b">
      <div className="flex gap-4" aria-label="Exception status">
        {(["open", "answered"] as const).map((view) => <button key={view} type="button" aria-pressed={view === "open"}
          className={view === "open" ? "border-b-2 border-foreground px-1 py-3 text-panel font-medium" : "border-b-2 border-transparent px-1 py-3 text-panel text-muted-foreground"}>
          {view === "open" ? "Needs review" : "Answered"} <span className="ml-1 tabular-nums text-muted-foreground">{EXCEPTION_COUNTS[view]}</span>
        </button>)}
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Input placeholder="Search evidence, domains, or notes…" aria-label="Search exceptions" defaultValue="" className="min-w-52 flex-1" />
      <NativeSelect aria-label="Exception category" defaultValue="all">
        {CATEGORY_TABS.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.id === "all" ? "All categories" : item.label}</NativeSelectOption>)}
      </NativeSelect>
      <NativeSelect aria-label="Exception order" defaultValue="oldest">
        <NativeSelectOption value="oldest">Oldest first</NativeSelectOption><NativeSelectOption value="newest">Newest first</NativeSelectOption>
      </NativeSelect>
    </div>
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.35fr)]">
      <section aria-label="Exception inbox" className="overflow-hidden rounded-lg border">
        <div className="border-b bg-sidebar px-3 py-2 text-xs text-muted-foreground">1–1 of 1</div>
        <ul className="divide-y">
          <li><button type="button" aria-current="true" className="flex w-full flex-col gap-1.5 border-l border-link bg-hover px-3 py-3 text-left">
            <span className="flex w-full items-center justify-between gap-2 text-xs text-muted-foreground"><span>{categoryLabel}</span><StatusDot className="shrink-0" tone="needs-you" label="Needs review" /></span>
            <span className="line-clamp-2 text-panel font-medium">{exceptionTitle(row.exception, row.action)}</span>
            {description ? <span className="line-clamp-2 text-panel text-muted-foreground">{description}</span> : null}
            {domains.length ? <span className="truncate text-xs text-muted-foreground">{domains.join(" · ")}</span> : null}
            <span className="text-xs text-faint"><DateTime iso={row.exception.created_at} /></span>
          </button></li>
        </ul>
        <div className="flex items-center justify-between gap-2 border-t p-2">
          <Button variant="ghost" size="sm" disabled aria-label="Previous page"><ChevronLeft />Previous</Button>
          <span className="text-xs text-muted-foreground">1 / 1</span>
          <Button variant="ghost" size="sm" disabled aria-label="Next page">Next<ChevronRight /></Button>
        </div>
      </section>
      <section aria-label="Selected exception" className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" size="sm"><ArrowLeft />Back to inbox</Button>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled>Previous item</Button>
            <Button variant="outline" size="sm" disabled>Next item</Button>
          </div>
        </div>
        <div data-stage-card><ExceptionCard exception={DEPLOY_EXCEPTION} action={DEPLOY_ACTION} unit={DEPLOY_UNIT} /></div>
      </section>
    </div>
  </div>;
}

function ExceptionScene({ t }: { t: number }) {
  const [origin, rects] = useFrameRects((frame) => ({
    approve: buttonByText(frame, "Approve change"),
    compare: frame.querySelector("[data-stage-card] .grid"),
  }));
  useElementStyle(() => buttonByText(document, "Approve change"), interaction(t, { hover: [HOVER, 3.6], click: CLICK }));
  const approve = rects.approve ?? { cx: 1500, cy: 800 };
  const compare = rects.compare;
  return (
    <StageProviders seed={seed}>
      <Camera t={t} keys={[[0, 1, approve.cx, approve.cy - 120], [3.6, 1.12, approve.cx, approve.cy - 120]]}>
        <div ref={origin} style={ORIGIN} />
        <StageShell title="Exceptions" width="wide"><Inbox /></StageShell>
        {compare ? <Highlight t={t} from={0.25} to={HOVER} x={compare.x} y={compare.y} w={compare.w} h={compare.h} /> : null}
        <Cursor t={t} path={[[0, approve.cx + 300, approve.cy - 240], [0.15, approve.cx + 290, approve.cy - 230], [HOVER - 0.1, approve.cx + 24, approve.cy + 8]]} clicks={[CLICK]} />
      </Camera>
    </StageProviders>
  );
}

export const exception: Scene = { duration: 3.6, Component: ExceptionScene, title: "Exception" };
