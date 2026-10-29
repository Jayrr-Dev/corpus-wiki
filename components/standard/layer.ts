import type * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Shared props for the layer primitives (Gradient, Noise, Pattern, Color
 * Grade, Distort, Mask). Put layers inside any `relative isolate` parent:
 * `behind` sits under the parent's content but above its background, `over`
 * sits on top of the content.
 */
type LayerPlacement = "behind" | "over"

type LayerBlend = Extract<
  React.CSSProperties["mixBlendMode"],
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "soft-light"
  | "hard-light"
  | "color-dodge"
  | "color-burn"
  | "difference"
  | "luminosity"
  | "color"
>

type LayerProps = {
  placement?: LayerPlacement
  blend?: LayerBlend
  /** 0–1. */
  opacity?: number
  className?: string
  style?: React.CSSProperties
}

/** Class and style for an absolutely positioned, non-interactive layer. */
function layerProps(
  { placement = "behind", blend, opacity, className, style }: LayerProps,
  slot: string
) {
  return {
    "aria-hidden": true,
    "data-slot": slot,
    "data-placement": placement,
    className: cn(
      "pointer-events-none absolute inset-0 rounded-[inherit] forced-colors:hidden",
      placement === "behind" ? "-z-10" : "z-10",
      className
    ),
    style: { mixBlendMode: blend, opacity, ...style },
  } as const
}

/** SVG markup as a CSS url(), for textures that need no DOM. */
function svgUrl(svg: string) {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

export { layerProps, svgUrl, type LayerBlend, type LayerPlacement, type LayerProps }
