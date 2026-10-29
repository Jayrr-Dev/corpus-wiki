"use client";
/* eslint-disable shadcn/no-inline-styles -- stage frames compute every position, scale and opacity from t */

import type { ReactNode } from "react";
import { StatusDot } from "@/app/(app)/_components/StatusDot";
import type { Tone } from "@/app/(app)/_lib/tone";
import { easeOut, seg } from "./time";

type Corner = "bottom-right" | "bottom-left" | "top-right" | "top-left";

export type ToastProps = {
  t: number;
  from: number;
  to: number;
  title: ReactNode;
  description?: ReactNode;
  // a status dot before the title, as the app's error toast has
  tone?: Tone;
  corner?: Corner;
};

// Same card and position as the app's Sonner toaster (components/toast/Toaster.tsx)
const CARD = "flex w-80 items-start gap-2 rounded-md border bg-background p-3 text-panel text-text shadow-lg";
const PLACE: Record<Corner, { x: "left" | "right"; y: "top" | "bottom" }> = {
  "bottom-right": { x: "right", y: "bottom" },
  "bottom-left": { x: "left", y: "bottom" },
  "top-right": { x: "right", y: "top" },
  "top-left": { x: "left", y: "top" },
};

// TOAST: slides in at `from` and fades out at `to`
export function Toast({ t, from, to, title, description, tone, corner = "bottom-right" }: ToastProps) {
  const enter = easeOut(seg(t, from, from + 0.35));
  const leave = seg(t, to - 0.3, to);
  if (enter <= 0 || leave >= 1) return null;
  const { x, y } = PLACE[corner];
  const slide = (1 - enter) * 18 * (y === "bottom" ? 1 : -1);
  return (
    <div role="status" className={CARD} style={{ position: "absolute", [x]: 40, [y]: 24, zIndex: 998, opacity: enter * (1 - leave), transform: `translateY(${slide}px)` }}>
      {tone ? <span className="flex h-lh shrink-0 items-center"><StatusDot tone={tone} /></span> : null}
      <div className="flex min-w-0 flex-col">
        <div className="font-medium">{title}</div>
        {description ? <div className="text-muted-foreground">{description}</div> : null}
      </div>
    </div>
  );
}
