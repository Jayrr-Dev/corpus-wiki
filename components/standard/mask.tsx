import * as React from "react"

import { layerProps, type LayerProps } from "@/components/standard/layer"

const maskKinds = ["fade", "edges", "vignette", "spotlight"] as const

type MaskKind = (typeof maskKinds)[number]

type MaskDirection = "top" | "right" | "bottom" | "left"

type MaskProps = Partial<LayerProps> & {
  kind?: MaskKind
  /** Which side fades out, for `fade`. */
  direction?: MaskDirection
  /** 0–100. How much of the box the fade takes. */
  softness?: number
  /** Center for `vignette` and `spotlight`, e.g. "50% 30%". */
  at?: string
  children: React.ReactNode
}

function maskImage(
  kind: MaskKind,
  direction: MaskDirection,
  softness: number,
  at: string
) {
  const solid = 100 - softness

  switch (kind) {
    case "fade":
      return `linear-gradient(to ${direction}, #000 ${solid}%, transparent)`
    case "edges": {
      const edge = softness / 2
      return `linear-gradient(to right, transparent, #000 ${edge}%, #000 ${100 - edge}%, transparent), linear-gradient(to bottom, transparent, #000 ${edge}%, #000 ${100 - edge}%, transparent)`
    }
    case "vignette":
      return `radial-gradient(ellipse at ${at}, #000 ${solid}%, transparent)`
    case "spotlight":
      return `radial-gradient(circle at ${at}, #000, transparent ${Math.max(solid, 10)}%)`
  }
}

/**
 * Hides parts of its children with a soft alpha ramp. Give it a `placement`
 * to wrap other layers as one masked layer group.
 */
function Mask({
  kind = "fade",
  direction = "bottom",
  softness = 50,
  at = "50% 50%",
  placement,
  children,
  className,
  style,
  ...layer
}: MaskProps) {
  const image = maskImage(kind, direction, softness, at)
  const masking: React.CSSProperties = {
    maskImage: image,
    WebkitMaskImage: image,
    maskComposite: kind === "edges" ? "intersect" : undefined,
    WebkitMaskComposite: kind === "edges" ? "source-in" : undefined,
  }

  if (placement) {
    const props = layerProps({ ...layer, placement, className, style }, "mask")

    return (
      <div {...props} data-kind={kind} style={{ ...masking, ...props.style }}>
        {children}
      </div>
    )
  }

  return (
    <div
      data-slot="mask"
      data-kind={kind}
      className={className}
      style={{ ...masking, ...style }}
    >
      {children}
    </div>
  )
}

export { Mask, maskKinds, type MaskDirection, type MaskKind, type MaskProps }
