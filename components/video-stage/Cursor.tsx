"use client";
/* eslint-disable shadcn/no-inline-styles -- stage frames compute every position, scale and opacity from t */

import { pressDepth } from "./interaction";
import { easeOut, keyframes, lerp, seg } from "./time";

// =====================================================================
// CURSOR AND RIPPLE: a large ad-style pointer that glides along a path
// of [time, x, y] keys (frame pixels, 1920x1080), dips at each click and
// leaves a ring that expands and fades.
// =====================================================================

const OVERLAY = { position: "absolute", left: 0, top: 0, pointerEvents: "none", zIndex: 1000 } as const;

export type CursorProps = {
  t: number;
  path: readonly (readonly [number, number, number])[];
  clicks?: readonly number[];
  // pointer height in pixels
  size?: number;
};

export function Cursor({ t, path, clicks = [], size = 46 }: CursorProps) {
  if (path.length === 0) return null;
  const x = keyframes(t, path.map(([time, px]) => [time, px] as const));
  const y = keyframes(t, path.map(([time, , py]) => [time, py] as const));
  const depth = Math.max(0, ...clicks.map((c) => pressDepth(t, c)));
  const scale = 1 - 0.18 * depth;
  return (
    <>
      {clicks.map((at) => <Ripple key={at} t={t} at={at} x={keyframes(at, path.map(([time, px]) => [time, px] as const))} y={keyframes(at, path.map(([time, , py]) => [time, py] as const))} />)}
      <svg
        aria-hidden
        width={size * 0.8}
        height={size}
        viewBox="0 0 20 25"
        style={{ ...OVERLAY, overflow: "visible", transform: `translate(${x}px, ${y}px) scale(${scale})`, transformOrigin: "0 0", filter: "drop-shadow(0 4px 8px rgb(0 0 0 / 0.45)) drop-shadow(0 1px 2px rgb(0 0 0 / 0.5))" }}
      >
        {/* tip at (1, 1), nudged to (0, 0) by the translate below */}
        <path transform="translate(-1 -1)" d="M1 1 L1 20.5 L5.9 15.9 L9.2 23.4 L12.8 21.8 L9.6 14.5 L16.2 14.5 Z" className="fill-white stroke-black" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    </>
  );
}

export type RippleProps = { t: number; at: number; x: number; y: number; duration?: number };

// A ring that expands from (x, y) and fades, starting at `at`
export function Ripple({ t, at, x, y, duration = 0.6 }: RippleProps) {
  const p = seg(t, at, at + duration);
  if (t < at || p >= 1) return null;
  const radius = lerp(6, 54, easeOut(p));
  return (
    <div
      aria-hidden
      style={{
        ...OVERLAY,
        width: radius * 2,
        height: radius * 2,
        transform: `translate(${x - radius}px, ${y - radius}px)`,
        borderRadius: "50%",
        border: "3px solid rgb(255 255 255 / 0.95)",
        boxShadow: "0 0 18px 2px rgb(255 255 255 / 0.35), inset 0 0 12px rgb(255 255 255 / 0.25)",
        opacity: (1 - p) * 0.9,
      }}
    />
  );
}
