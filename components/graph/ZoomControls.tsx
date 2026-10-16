"use client";

import type { ReactNode } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { Tooltip } from "@/components/standard/tooltip";

// =====================================================================
// ZOOM CONTROLS: zoom in, zoom out and fit-to-view buttons over the graph,
// for when there is no wheel or pinch handy (a trackpad-less mouse, a
// phone held in one hand). Fit hands the view back to auto-fit.
// =====================================================================

interface ZoomControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}

// CONTROL STACK: three square buttons in one bordered column
export function ZoomControls({ onZoomIn, onZoomOut, onFit }: ZoomControlsProps) {
  return (
    <div className="absolute right-3 bottom-8 flex flex-col overflow-hidden rounded-md border bg-background/90 shadow-sm backdrop-blur">
      <ZoomButton label="Zoom in" onClick={onZoomIn}><Plus className="size-4" /></ZoomButton>
      <ZoomButton label="Zoom out" onClick={onZoomOut}><Minus className="size-4" /></ZoomButton>
      <ZoomButton label="Fit to view" onClick={onFit}><Maximize2 className="size-3.5" /></ZoomButton>
    </div>
  );
}

// ZOOM BUTTON: a 32px target on desktop, 40px on phones
function ZoomButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip content={label} side="left">
      <button type="button" aria-label={label} onClick={onClick} className="flex size-8 items-center justify-center text-muted-foreground not-last:border-b hover:bg-hover hover:text-foreground max-md:size-10">
        {children}
      </button>
    </Tooltip>
  );
}
