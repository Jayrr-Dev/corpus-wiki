"use client";
/* eslint-disable shadcn/no-inline-styles -- stage frames compute every position, scale and opacity from t */

import { seg } from "./time";

export type HighlightProps = { t: number; from: number; to: number; x: number; y: number; w: number; h: number; radius?: number; pad?: number };

// HIGHLIGHT: a soft glow ring around a rectangle (frame pixels), fading in at `from` and out at `to`
export function Highlight({ t, from, to, x, y, w, h, radius = 10, pad = 6 }: HighlightProps) {
  const opacity = seg(t, from, from + 0.3) * (1 - seg(t, to - 0.3, to));
  if (opacity <= 0) return null;
  const breathe = 1 + 0.012 * Math.sin((t - from) * Math.PI * 1.6);
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: x - pad,
        top: y - pad,
        width: w + pad * 2,
        height: h + pad * 2,
        borderRadius: radius + pad,
        pointerEvents: "none",
        zIndex: 999,
        opacity,
        transform: `scale(${breathe})`,
        border: "2px solid rgb(255 255 255 / 0.85)",
        boxShadow: "0 0 0 4px rgb(255 255 255 / 0.12), 0 0 36px 6px rgb(160 190 255 / 0.35)",
      }}
    />
  );
}
