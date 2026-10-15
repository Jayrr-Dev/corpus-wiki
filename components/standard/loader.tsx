"use client"

// LOADER: the app's one loading indicator, an Atom Grid cycling its patterns.
// Block (default): a 5×5 grid centred in the space it is given, for a page, table or panel body.
// Inline: a small 3×3 grid in front of a faint line of text, for sidebars, chips and sub-sections.

import { cn } from "@/lib/utils"
import { AtomGridCycle } from "@/components/standard/atom-grid"

type LoaderProps = { label?: string; inline?: boolean; className?: string }

function Loader({ label, inline = false, className }: LoaderProps) {
  if (inline) {
    return (
      <div className={cn("flex items-center gap-2 text-panel text-faint", className)}>
        <AtomGridCycle size={3} dot={3} gap={2} cycles={1} className="shrink-0 text-text" />
        {label ? <span>{label}</span> : null}
      </div>
    )
  }
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-16", className)}>
      <AtomGridCycle cycles={1} className="text-text" />
      {label ? <p className="text-panel text-faint">{label}</p> : null}
    </div>
  )
}

export { Loader }
