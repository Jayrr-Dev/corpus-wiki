"use client"

import * as React from "react"

import { layerProps, type LayerProps } from "@/components/standard/layer"

const screentoneKinds = [
  "dots",
  "lines",
  "crosshatch",
  "diamonds",
  "rings",
  "noise",
] as const

type ScreentoneKind = (typeof screentoneKinds)[number]

/** Graded tones: where the ink is densest. `flat` is even all over. */
const screentoneGradations = [
  "flat",
  "top",
  "bottom",
  "left",
  "right",
  "center",
  "edges",
  "corner",
] as const

/** Organic tones: ink density follows generated smoke, cloth, marble or rain. */
const screentoneTextures = ["clouds", "folds", "marble", "streaks"] as const

const screentoneTones = [...screentoneGradations, ...screentoneTextures] as const

type ScreentoneTone = (typeof screentoneTones)[number]

type ScreentoneTexture = (typeof screentoneTextures)[number]

/** Screen angle per kind, in degrees. Print screens avoid 0° for dots. */
const defaultAngles: Record<ScreentoneKind, number> = {
  dots: 45,
  lines: -45,
  crosshatch: 45,
  diamonds: 0,
  rings: 0,
  noise: 0,
}

const defaultSizes: Record<ScreentoneKind, number> = {
  dots: 8,
  lines: 6,
  crosshatch: 7,
  diamonds: 9,
  rings: 10,
  noise: 2.5,
}

/** Turbulence behind each organic tone. Two frequencies stretch it. */
const textureNoise: Record<
  ScreentoneTexture,
  { type: "fractalNoise" | "turbulence"; frequency: string; octaves: number }
> = {
  clouds: { type: "fractalNoise", frequency: "0.006", octaves: 4 },
  folds: { type: "fractalNoise", frequency: "0.0025 0.018", octaves: 2 },
  marble: { type: "turbulence", frequency: "0.007", octaves: 3 },
  streaks: { type: "fractalNoise", frequency: "0.07 0.0025", octaves: 2 },
}

type ScreentoneProps = LayerProps & {
  kind?: ScreentoneKind
  tone?: ScreentoneTone
  /**
   * 0–1 ink coverage as [dense, light]. `flat` uses the first value;
   * organic tones spread between the two.
   */
  density?: [number, number]
  /** Screen cell in px. */
  size?: number
  /** Screen rotation in degrees. */
  angle?: number
  /** Center for `rings` and `center`, e.g. "50% 50%". */
  at?: string
  /** Varies organic tones and grit. */
  seed?: number
  /** Chewed, printed dot edges. */
  rough?: boolean
  /** Any CSS color. Defaults to a faint foreground. */
  color?: string
}

const round = (value: number) => Math.round(value * 1000) / 1000

const gray = (value: number) => {
  const channel = Math.round(Math.min(Math.max(value, 0), 1) * 255)
  return `rgb(${channel} ${channel} ${channel})`
}

const isTexture = (tone: ScreentoneTone): tone is ScreentoneTexture =>
  (screentoneTextures as readonly string[]).includes(tone)

/**
 * The density field, as a full-size rect. Brighter means more ink. Graded
 * tones are SVG gradients; organic tones are turbulence stretched to span
 * the density range.
 */
function ToneField({
  id,
  tone,
  density: [dense, light],
  at,
  seed,
}: {
  id: string
  tone: ScreentoneTone
  density: [number, number]
  at: string
  seed: number
}) {
  if (isTexture(tone)) {
    const { type, frequency, octaves } = textureNoise[tone]
    // fractalNoise sits around 0.5 ± 0.25, turbulence around 0.25 ± 0.25.
    const [low, span] = type === "fractalNoise" ? [0.25, 0.5] : [0.02, 0.45]
    const gain = round((dense - light) / span)
    const offset = round(light - gain * low)
    const row = `${gain} 0 0 0 ${offset}`

    return (
      <>
        <defs>
          <filter id={id} x="0" y="0" width="1" height="1" colorInterpolationFilters="sRGB">
            <feTurbulence type={type} baseFrequency={frequency} numOctaves={octaves} seed={seed} />
            <feColorMatrix type="matrix" values={`${row} ${row} ${row} 0 0 0 0 1`} />
          </filter>
        </defs>
        <rect width="100%" height="100%" filter={`url(#${id})`} />
      </>
    )
  }

  let gradient: React.ReactNode

  if (tone === "center" || tone === "edges" || tone === "corner") {
    const [inner, outer] = tone === "edges" ? [light, dense] : [dense, light]
    const [cx, cy] = tone === "corner" ? ["0", "0"] : at.split(" ")
    gradient = (
      <radialGradient id={id} cx={cx} cy={cy ?? cx} r={tone === "corner" ? "1.3" : "0.75"}>
        <stop offset="0" stopColor={gray(inner)} />
        <stop offset="1" stopColor={gray(outer)} />
      </radialGradient>
    )
  } else {
    const vectors: Record<string, [number, number, number, number]> = {
      flat: [0, 0, 0, 1],
      top: [0, 0, 0, 1],
      bottom: [0, 1, 0, 0],
      left: [0, 0, 1, 0],
      right: [1, 0, 0, 0],
    }
    const [x1, y1, x2, y2] = vectors[tone] ?? vectors.top!
    gradient = (
      <linearGradient id={id} x1={x1} y1={y1} x2={x2} y2={y2}>
        <stop offset="0" stopColor={gray(dense)} />
        <stop offset="1" stopColor={gray(tone === "flat" ? dense : light)} />
      </linearGradient>
    )
  }

  return (
    <>
      <defs>{gradient}</defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </>
  )
}

/**
 * Soft cell texture: 1 at a dot center or line spine, falling to 0. Mixed
 * with the tone and cut at 50%, it becomes dots or lines that grow with it.
 */
function CellField({
  id,
  kind,
  size,
  angle,
  at,
}: {
  id: string
  kind: Exclude<ScreentoneKind, "crosshatch">
  size: number
  angle: number
  at: string
}) {
  const falloff = `${id}-falloff`

  if (kind === "noise") {
    return (
      <>
        <defs>
          <filter id={id} x="0" y="0" width="1" height="1" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency={round(0.7 / size)} numOctaves={2} />
            <feColorMatrix
              type="matrix"
              values="2.4 0 0 0 -0.7 2.4 0 0 0 -0.7 2.4 0 0 0 -0.7 0 0 0 0 1"
            />
          </filter>
        </defs>
        <rect width="100%" height="100%" filter={`url(#${id})`} />
      </>
    )
  }

  /* SVG mask luminance, not a theme color */
  if (kind === "rings") {
    const [cx, cy] = at.split(" ")
    return (
      <>
        <defs>
          <radialGradient
            id={id}
            gradientUnits="userSpaceOnUse"
            cx={cx}
            cy={cy ?? cx}
            r={size}
            spreadMethod="repeat"
          >
            <stop offset="0" stopColor="black" />
            <stop offset="0.5" stopColor="white" />
            <stop offset="1" stopColor="black" />
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${id})`} />
      </>
    )
  }

  return (
    <>
      <defs>
        {kind === "dots" ? (
          <radialGradient id={falloff}>
            <stop offset="0" stopColor="white" />
            <stop offset="1" stopColor="black" />
          </radialGradient>
        ) : (
          <linearGradient id={falloff} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="black" />
            <stop offset="0.5" stopColor="white" />
            <stop offset="1" stopColor="black" />
          </linearGradient>
        )}
        <pattern
          id={id}
          width={size}
          height={size}
          patternUnits="userSpaceOnUse"
          patternTransform={`rotate(${angle})`}
        >
          {kind === "dots" ? (
            <>
              <rect width={size} height={size} fill="black" />
              <circle
                cx={size / 2}
                cy={size / 2}
                r={size * Math.SQRT1_2}
                fill={`url(#${falloff})`}
              />
            </>
          ) : kind === "lines" ? (
            <rect width={size} height={size} fill={`url(#${falloff})`} />
          ) : (
            // Averaging two crossed line ramps gives diamond-shaped level sets.
            <>
              <rect width={size} height={size} fill={`url(#${falloff})`} />
              <rect
                width={size}
                height={size}
                fill={`url(#${falloff})`}
                opacity={0.5}
                transform={`rotate(90 ${size / 2} ${size / 2})`}
              />
            </>
          )}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </>
  )
}

/**
 * One screen: cells and tone averaged, cut at 50%, optionally roughened,
 * then painted in currentColor.
 */
function ScreenLayer({
  id,
  kind,
  size,
  angle,
  at,
  tone,
  density,
  sharpness,
  rough,
  seed,
}: {
  id: string
  kind: Exclude<ScreentoneKind, "crosshatch">
  size: number
  angle: number
  at: string
  tone: ScreentoneTone
  density: [number, number]
  sharpness: number
  rough: boolean
  seed: number
}) {
  const threshold = `${id}-threshold`

  return (
    <>
      <defs>
        <filter id={threshold} x="0" y="0" width="1" height="1" colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values={`0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${sharpness} 0 0 0 ${-sharpness / 2}`}
            result="ink"
          />
          {rough ? (
            <>
              <feTurbulence
                type="fractalNoise"
                baseFrequency={round(1.1 / size)}
                numOctaves={2}
                seed={seed + 7}
                result="grit"
              />
              <feDisplacementMap
                in="ink"
                in2="grit"
                scale={round(size * 0.45)}
                xChannelSelector="R"
                yChannelSelector="G"
                result="inked"
              />
            </>
          ) : null}
          <feFlood floodColor="currentColor" />
          <feComposite in2={rough ? "inked" : "ink"} operator="in" />
        </filter>
      </defs>
      <g filter={`url(#${threshold})`}>
        <CellField id={`${id}-cells`} kind={kind} size={size} angle={angle} at={at} />
        <g opacity={0.5}>
          <ToneField id={`${id}-tone`} tone={tone} density={density} at={at} seed={seed} />
        </g>
      </g>
    </>
  )
}

/**
 * Manga-style halftone tone. Dots, lines, crosshatch, diamonds, rings or
 * noise that grow with a graded or organic density.
 */
function Screentone({
  kind = "dots",
  tone = "bottom",
  density,
  size,
  angle,
  at = "50% 50%",
  seed = 1,
  rough = false,
  color = "color-mix(in oklch, var(--foreground) 32%, transparent)",
  ...layer
}: ScreentoneProps) {
  const id = `screentone-${React.useId().replace(/:/g, "")}`
  const cell = size ?? defaultSizes[kind]
  const turn = angle ?? defaultAngles[kind]
  const ramp: [number, number] =
    density ?? (tone === "flat" ? [0.4, 0.4] : isTexture(tone) ? [0.85, -0.25] : [0.95, 0.02])
  // Steeper cut for small cells keeps edges crisp without aliasing big ones.
  const sharpness = Math.round(Math.max(12, 60 / Math.sqrt(cell)))
  const props = layerProps(layer, "screentone")
  const screen = { size: cell, at, tone, density: ramp, sharpness, rough, seed }

  return (
    <svg
      {...props}
      data-kind={kind}
      data-tone={tone}
      width="100%"
      height="100%"
      style={{ color, ...props.style }}
    >
      {kind === "crosshatch" ? (
        <>
          <ScreenLayer id={`${id}-a`} kind="lines" angle={turn} {...screen} />
          <ScreenLayer id={`${id}-b`} kind="lines" angle={turn + 90} {...screen} />
        </>
      ) : (
        <ScreenLayer id={id} kind={kind} angle={turn} {...screen} />
      )}
    </svg>
  )
}

export {
  Screentone,
  screentoneGradations,
  screentoneKinds,
  screentoneTextures,
  screentoneTones,
  type ScreentoneKind,
  type ScreentoneProps,
  type ScreentoneTone,
}
