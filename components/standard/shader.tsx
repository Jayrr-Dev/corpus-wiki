"use client"

import * as React from "react"
import {
  ColorPanels,
  colorPanelsPresets,
  Dithering,
  ditheringPresets,
  DotGrid,
  dotGridPresets,
  DotOrbit,
  dotOrbitPresets,
  GodRays,
  godRaysPresets,
  GrainGradient,
  grainGradientPresets,
  MeshGradient,
  meshGradientPresets,
  Metaballs,
  metaballsPresets,
  NeuroNoise,
  neuroNoisePresets,
  PerlinNoise,
  perlinNoisePresets,
  PulsingBorder,
  pulsingBorderPresets,
  SimplexNoise,
  simplexNoisePresets,
  SmokeRing,
  smokeRingPresets,
  Spiral,
  spiralPresets,
  StaticMeshGradient,
  staticMeshGradientPresets,
  StaticRadialGradient,
  staticRadialGradientPresets,
  Swirl,
  swirlPresets,
  Voronoi,
  voronoiPresets,
  Warp,
  warpPresets,
  Waves,
  wavesPresets,
  getShaderColorFromString,
  ShaderMount,
} from "@paper-design/shaders-react"

import { layerProps, type LayerProps } from "@/components/standard/layer"
import {
  shaderProgramPresets,
  shaderPrograms,
  type ShaderProgramKind,
  type ShaderProgramParams,
} from "@/components/standard/shader-programs"

type ShaderParams = Record<string, unknown>

type ShaderEntry = {
  Component: React.ComponentType<ShaderParams>
  presets: { name: string; params: ShaderParams }[]
}

const entry = (Component: unknown, presets: unknown): ShaderEntry => ({
  Component: Component as ShaderEntry["Component"],
  presets: presets as ShaderEntry["presets"],
})

/** Mounts one of our own programs with its colors and scale as uniforms. */
function programEntry(kind: ShaderProgramKind): ShaderEntry {
  function ProgramShader({
    colorBack,
    colorFront,
    colorAccent,
    scale,
    speed,
    frame,
    style,
  }: Partial<ShaderProgramParams> & { frame?: number; style?: React.CSSProperties }) {
    return (
      <ShaderMount
        fragmentShader={shaderPrograms[kind]}
        uniforms={{
          u_colorBack: getShaderColorFromString(colorBack),
          u_colorFront: getShaderColorFromString(colorFront),
          u_colorAccent: getShaderColorFromString(colorAccent),
          u_density: scale ?? 1,
        }}
        speed={speed}
        frame={frame}
        style={style}
      />
    )
  }

  return entry(ProgramShader, shaderProgramPresets[kind])
}

/** Every generative shader from Paper Shaders, plus our own, keyed by kind. */
const shaders = {
  "mesh-gradient": entry(MeshGradient, meshGradientPresets),
  "static-mesh-gradient": entry(StaticMeshGradient, staticMeshGradientPresets),
  "static-radial-gradient": entry(StaticRadialGradient, staticRadialGradientPresets),
  "grain-gradient": entry(GrainGradient, grainGradientPresets),
  "color-panels": entry(ColorPanels, colorPanelsPresets),
  dithering: entry(Dithering, ditheringPresets),
  "dot-orbit": entry(DotOrbit, dotOrbitPresets),
  "dot-grid": entry(DotGrid, dotGridPresets),
  metaballs: entry(Metaballs, metaballsPresets),
  warp: entry(Warp, warpPresets),
  spiral: entry(Spiral, spiralPresets),
  swirl: entry(Swirl, swirlPresets),
  waves: entry(Waves, wavesPresets),
  "neuro-noise": entry(NeuroNoise, neuroNoisePresets),
  "perlin-noise": entry(PerlinNoise, perlinNoisePresets),
  "simplex-noise": entry(SimplexNoise, simplexNoisePresets),
  voronoi: entry(Voronoi, voronoiPresets),
  "god-rays": entry(GodRays, godRaysPresets),
  "smoke-ring": entry(SmokeRing, smokeRingPresets),
  "pulsing-border": entry(PulsingBorder, pulsingBorderPresets),
  mandelbrot: programEntry("mandelbrot"),
  julia: programEntry("julia"),
  "burning-ship": programEntry("burningShip"),
  newton: programEntry("newton"),
  sierpinski: programEntry("sierpinski"),
  apollonian: programEntry("apollonian"),
  hypno: programEntry("hypno"),
  plasma: programEntry("plasma"),
  tunnel: programEntry("tunnel"),
  kaleidoscope: programEntry("kaleidoscope"),
  starfield: programEntry("starfield"),
  matrix: programEntry("matrix"),
  terminal: programEntry("terminal"),
  synthwave: programEntry("synthwave"),
  aurora: programEntry("aurora"),
  spotlight: programEntry("spotlight"),
  beam: programEntry("beam"),
  shine: programEntry("shine"),
  bokeh: programEntry("bokeh"),
} satisfies Record<string, ShaderEntry>

type ShaderKind = keyof typeof shaders

/** Kinds grouped by look, for pickers. */
const shaderGroups = {
  gradient: [
    "mesh-gradient",
    "static-mesh-gradient",
    "static-radial-gradient",
    "grain-gradient",
    "color-panels",
  ],
  noise: [
    "perlin-noise",
    "simplex-noise",
    "neuro-noise",
    "voronoi",
    "warp",
    "swirl",
    "spiral",
    "waves",
  ],
  dots: ["dot-orbit", "dot-grid", "dithering", "metaballs"],
  light: [
    "spotlight",
    "beam",
    "shine",
    "bokeh",
    "god-rays",
    "smoke-ring",
    "pulsing-border",
    "aurora",
  ],
  fractal: ["mandelbrot", "julia", "burning-ship", "newton", "sierpinski", "apollonian"],
  retro: ["hypno", "plasma", "tunnel", "kaleidoscope", "starfield"],
  code: ["matrix", "terminal", "synthwave"],
} as const satisfies Record<string, readonly ShaderKind[]>

const shaderKinds = Object.keys(shaders) as ShaderKind[]

/** Preset names for a kind, in Paper's order. The first is the default. */
function shaderPresetNames(kind: ShaderKind) {
  return shaders[kind].presets.map((preset) => preset.name)
}

type ShaderProps = LayerProps & {
  kind?: ShaderKind
  /** A preset name from `shaderPresetNames(kind)`. Defaults to the first. */
  preset?: string
  /** Overrides on top of the preset, e.g. `{ colors: [...], distortion: 0.5 }`. */
  params?: ShaderParams
  /** Animation speed. 0 renders a still frame. Always 0 under reduced motion. */
  speed?: number
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"

function subscribeToReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

function useReducedMotion() {
  return React.useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false
  )
}

/**
 * WebGL shader layer: mesh gradients, noise fields, dot fields and light
 * effects from Paper Shaders. Each one is its own GPU context, so keep a
 * handful per page and prefer `speed={0}` for many.
 */
function Shader({
  kind = "mesh-gradient",
  preset,
  params,
  speed,
  ...layer
}: ShaderProps) {
  const reduced = useReducedMotion()
  const { Component, presets } = shaders[kind]
  const chosen = presets.find((entry) => entry.name === preset) ?? presets[0]!
  const props = layerProps(layer, "shader")

  return (
    <div {...props} data-kind={kind} data-preset={chosen.name}>
      <Component
        {...chosen.params}
        {...params}
        speed={reduced ? 0 : (speed ?? chosen.params.speed)}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  )
}

export {
  Shader,
  shaderGroups,
  shaderKinds,
  shaderPresetNames,
  type ShaderKind,
  type ShaderProps,
}
