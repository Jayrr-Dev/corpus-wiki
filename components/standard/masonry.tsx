"use client"

// MASONRY: cards of different heights stacked in columns with no row gaps. Items are dealt across the
// columns in order (1, 2, 3 on the top row, 4, 5, 6 under them), so reading order stays left to right and
// a card that grows only pushes down the cards below it in its own column, never reshuffles the others.

import * as React from "react"
import { cn } from "@/lib/utils"

// The column count at each viewport breakpoint, matching Tailwind's sm (640px) and xl (1280px)
type Columns = { base: number; sm?: number; xl?: number }

const QUERIES = { sm: "(min-width: 640px)", xl: "(min-width: 1280px)" } as const

function subscribe(onChange: () => void) {
  const lists = Object.values(QUERIES).map((query) => window.matchMedia(query))
  lists.forEach((list) => list.addEventListener("change", onChange))
  return () => lists.forEach((list) => list.removeEventListener("change", onChange))
}

function useColumnCount({ base, sm, xl }: Columns) {
  return React.useSyncExternalStore(
    subscribe,
    () => {
      if (xl !== undefined && window.matchMedia(QUERIES.xl).matches) return xl
      if (sm !== undefined && window.matchMedia(QUERIES.sm).matches) return sm
      return base
    },
    // The server cannot see the viewport, so it renders one column and the client corrects it on hydration
    () => base,
  )
}

export function Masonry({ columns, className, children }: { columns: Columns; className?: string; children: React.ReactNode }) {
  const count = useColumnCount(columns)
  const items = React.Children.toArray(children)
  const stacks = Array.from({ length: count }, (_, column) => items.filter((_, index) => index % count === column))
  return <div className={cn("flex items-start gap-5", className)}>
    {stacks.map((stack, column) => <div key={column} className="flex min-w-0 flex-1 flex-col gap-5">{stack}</div>)}
  </div>
}
