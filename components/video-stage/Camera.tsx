"use client";
/* eslint-disable shadcn/no-inline-styles -- stage frames compute every position, scale and opacity from t */

import type { ReactNode } from "react";
import { keyframes } from "./time";

export type CameraProps = {
  t: number;
  // [time, scale, originX, originY]: the point (originX, originY) in frame pixels stays put while the view scales around it
  keys: readonly (readonly [number, number, number, number])[];
  children: ReactNode;
};

// CAMERA: slow push-ins and pans over the whole frame, eased between keys
export function Camera({ t, keys, children }: CameraProps) {
  const scale = keys.length ? keyframes(t, keys.map(([time, s]) => [time, s] as const)) : 1;
  const ox = keys.length ? keyframes(t, keys.map(([time, , x]) => [time, x] as const)) : 960;
  const oy = keys.length ? keyframes(t, keys.map(([time, , , y]) => [time, y] as const)) : 540;
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, transform: `scale(${scale})`, transformOrigin: `${ox}px ${oy}px` }}>{children}</div>
    </div>
  );
}
