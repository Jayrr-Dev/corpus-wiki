import * as React from "react"

import { layerProps, svgUrl, type LayerProps } from "@/components/standard/layer"

const noiseKinds = ["grain", "paper", "clouds"] as const

type NoiseKind = (typeof noiseKinds)[number]

/**
 * Turbulence settings per kind. Paper stretches the noise into fibers.
 * Clouds are too smooth to tile without a visible seam, so they render once
 * and cover the box instead.
 */
const noiseDefaults: Record<
  NoiseKind,
  {
    frequency: string
    octaves: number
    tile: number
    opacity: number
    cover?: boolean
  }
> = {
  grain: { frequency: "0.9", octaves: 3, tile: 200, opacity: 0.3 },
  paper: { frequency: "0.02 0.6", octaves: 4, tile: 300, opacity: 0.25 },
  clouds: {
    frequency: "0.01",
    octaves: 4,
    tile: 960,
    opacity: 0.35,
    cover: true,
  },
}

type NoiseProps = LayerProps & {
  kind?: NoiseKind
  /** feTurbulence baseFrequency. One number, or "x y" to stretch. */
  frequency?: number | string
  octaves?: number
  seed?: number
  /** Tile size in px. Clouds draw one canvas of this size and cover the box. */
  tile?: number
  /** Gray noise. Off keeps the colored channels. */
  monochrome?: boolean
  /** Jitters grain and paper like film, drifts clouds. Stops under reduced motion. */
  animate?: boolean
}

function noiseSvg(
  frequency: string,
  octaves: number,
  seed: number,
  tile: number,
  monochrome: boolean,
  cover: boolean
) {
  const gray = monochrome
    ? `<feColorMatrix type='saturate' values='0'/>`
    : ""

  const frame = cover
    ? `viewBox='0 0 ${tile} ${tile}' preserveAspectRatio='xMidYMid slice'`
    : `width='${tile}' height='${tile}'`
  const stitch = cover ? "" : ` stitchTiles='stitch'`

  return `<svg xmlns='http://www.w3.org/2000/svg' ${frame}><filter id='n' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='${frequency}' numOctaves='${octaves}' seed='${seed}'${stitch}/>${gray}</filter><rect width='${tile}' height='${tile}' filter='url(#n)'/></svg>`
}

const noiseKeyframes = `@keyframes noise-jitter{0%{background-position:0 0}20%{background-position:-37px 21px}40%{background-position:53px -48px}60%{background-position:-14px 66px}80%{background-position:71px 9px}100%{background-position:0 0}}@keyframes noise-drift{0%{background-position:0% 0%}100%{background-position:100% 100%}}@media (prefers-reduced-motion:reduce){[data-slot=noise]{animation:none!important}}`

/** Random surface texture: grain, paper fibers or clouds. */
function Noise({
  kind = "grain",
  frequency,
  octaves,
  seed = 0,
  tile,
  monochrome = true,
  animate = false,
  ...layer
}: NoiseProps) {
  const defaults = noiseDefaults[kind]
  const size = tile ?? defaults.tile
  const cover = defaults.cover ?? false
  const props = layerProps(
    { opacity: defaults.opacity, ...layer },
    "noise"
  )

  return (
    <>
      {animate ? (
        <style href="standard-noise" precedence="default">
          {noiseKeyframes}
        </style>
      ) : null}
      <div
        {...props}
        data-kind={kind}
        style={{
          backgroundImage: svgUrl(
            noiseSvg(
              String(frequency ?? defaults.frequency),
              octaves ?? defaults.octaves,
              seed,
              size,
              monochrome,
              cover
            )
          ),
          // Clouds overshoot the box so the drift never shows an edge.
          backgroundSize: cover ? "140% 140%" : `${size}px ${size}px`,
          backgroundRepeat: cover ? "no-repeat" : undefined,
          backgroundPosition: cover ? "50% 50%" : undefined,
          animation: animate
            ? cover
              ? "noise-drift 24s ease-in-out infinite alternate"
              : "noise-jitter 0.6s steps(5) infinite"
            : undefined,
          ...props.style,
        }}
      />
    </>
  )
}

export { Noise, noiseKinds, type NoiseKind, type NoiseProps }
