"use client"

// ATOM GRID: dot-matrix loading indicator. A small grid of dots lit in a moving pattern, pure CSS once
// rendered: each dot runs the same `sb-atom-lit` keyframe (globals.css), offset by where it sits in the pattern.

import * as React from "react"
import { cn } from "@/lib/utils"

export type AtomPattern = "orbit" | "spiral" | "ripple" | "snake" | "rain"

// PHASE: for each cell, how far into the cycle (0..1) it lights up; null = never lit (stays dim)
type Phase = (r: number, c: number, n: number) => number | null

// The cells of an n×n grid walked clockwise from the top-left, ring by ring inward
function spiralOrder(n: number): [number, number][] {
  const out: [number, number][] = []
  let top = 0, left = 0, bottom = n - 1, right = n - 1
  while (top <= bottom && left <= right) {
    for (let c = left; c <= right; c++) out.push([top, c])
    for (let r = top + 1; r <= bottom; r++) out.push([r, right])
    if (top < bottom) for (let c = right - 1; c >= left; c--) out.push([bottom, c])
    if (left < right) for (let r = bottom - 1; r > top; r--) out.push([r, left])
    top++; left++; bottom--; right--
  }
  return out
}

function indexIn(order: [number, number][], r: number, c: number) {
  return order.findIndex(([rr, cc]) => rr === r && cc === c)
}

// Fixed per-column offsets so rain looks scattered without being random between renders
const RAIN_OFFSETS = [0, 0.45, 0.15, 0.7, 0.3, 0.85, 0.55, 0.1, 0.65]

const PATTERNS: Record<AtomPattern, Phase> = {
  // A light circling the outer ring
  orbit: (r, c, n) => {
    const ring = spiralOrder(n).slice(0, Math.max(1, 4 * (n - 1)))
    const i = indexIn(ring, r, c)
    return i < 0 ? null : i / ring.length
  },
  // A light winding from the edge into the centre
  spiral: (r, c, n) => indexIn(spiralOrder(n), r, c) / (n * n),
  // Rings expanding out of the centre
  ripple: (r, c, n) => {
    const mid = (n - 1) / 2
    return (Math.hypot(r - mid, c - mid) / Math.hypot(mid, mid)) * 0.6
  },
  // Back and forth, row by row
  snake: (r, c, n) => (r * n + (r % 2 ? n - 1 - c : c)) / (n * n),
  // Drops falling down each column at their own time
  rain: (r, c, n) => ((r / n) * 0.5 + (RAIN_OFFSETS[c % RAIN_OFFSETS.length] ?? 0)) % 1,
}

export const ATOM_PATTERNS = Object.keys(PATTERNS) as AtomPattern[]

type AtomGridProps = {
  pattern?: AtomPattern
  size?: number // dots per side
  dot?: number // px
  gap?: number // px
  speed?: number // seconds per cycle
  /** Hide it from assistive tech when a parent button already names the action. */
  decorative?: boolean
  className?: string
}

function AtomGrid({ pattern = "orbit", size = 5, dot = 6, gap = 3, speed = 1.2, decorative = false, className }: AtomGridProps) {
  const phase = PATTERNS[pattern]
  return (
    <div
      role={decorative ? undefined : "status"}
      aria-label={decorative ? undefined : "Loading"}
      aria-hidden={decorative ? true : undefined}
      className={cn("grid w-fit", className)}
      style={{ gridTemplateColumns: `repeat(${size}, ${dot}px)`, gap, ["--sb-atom-speed" as string]: `${speed}s` }}
    >
      {Array.from({ length: size * size }, (_, i) => {
        const at = phase(Math.floor(i / size), i % size, size)
        return (
          <span
            key={i}
            className={cn("rounded-full bg-current", at === null ? "opacity-15" : "sb-atom-dot")}
            style={{ width: dot, height: dot, animationDelay: at === null ? undefined : `${-(1 - at) * speed}s` }}
          />
        )
      })}
    </div>
  )
}

// ATOM GRID CYCLE: steps through several patterns, each for a couple of its cycles
function AtomGridCycle({ patterns = ATOM_PATTERNS, cycles = 2, speed = 1.2, ...props }: Omit<AtomGridProps, "pattern"> & { patterns?: AtomPattern[]; cycles?: number }) {
  const [index, setIndex] = React.useState(0)
  React.useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % patterns.length), cycles * speed * 1000)
    return () => clearInterval(id)
  }, [patterns.length, cycles, speed])
  // Keyed so each pattern restarts its animation from the beginning
  return <AtomGrid key={patterns[index]} pattern={patterns[index]} speed={speed} {...props} />
}

export { AtomGrid, AtomGridCycle }
