// SLIDER: jayrr.dev registry item "slider" (https://jayrr.dev/r/slider.json).
// Local changes: `cn` from "@/lib/utils" (one class merger); state variants use the
// attributes Radix sets (data-orientation), so the styles apply.

"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Slider as SliderPrimitive } from "radix-ui"

// Half the thumb (size-3). Radix keeps the thumb inside the track, so thumb
// centres run from THUMB_HALF to 100% - THUMB_HALF; marks follow the same span.
const THUMB_HALF = "0.375rem"
const MAX_AUTO_DIVISIONS = 20

type SliderVariant = "default" | "ticks" | "segments"

type SliderProps = React.ComponentProps<typeof SliderPrimitive.Root> & {
  /** `ticks` draws a mark at each division; `segments` splits the track. */
  variant?: SliderVariant
  /** Intervals to divide the track into. Defaults to one per step, up to 20. */
  divisions?: number
}

function Slider({
  className,
  defaultValue,
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  orientation = "horizontal",
  inverted = false,
  variant = "default",
  divisions,
  ...props
}: SliderProps) {
  const [uncontrolled, setUncontrolled] = React.useState(
    () => defaultValue ?? [min]
  )
  const current = value ?? uncontrolled

  const _values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max]
  )

  const count = React.useMemo(() => {
    if (divisions && divisions > 0) return Math.round(divisions)
    const steps = Math.round((max - min) / step)
    return steps > 0 && steps <= MAX_AUTO_DIVISIONS ? steps : 10
  }, [divisions, max, min, step])

  const low = current.length > 1 ? Math.min(...current) : min
  const high = Math.max(...current)
  const isVertical = orientation === "vertical"
  const fromEdge = isVertical
    ? inverted
      ? "top"
      : "bottom"
    : inverted
      ? "right"
      : "left"
  const toEdge = { left: "right", right: "left", top: "bottom", bottom: "top" }[
    fromEdge
  ]
  // Position along the thumb-centre span, as a CSS length from `fromEdge`.
  const at = (fraction: number) =>
    `calc(${THUMB_HALF} + (100% - 2 * ${THUMB_HALF}) * ${fraction})`
  const valueAt = (index: number) => min + ((max - min) * index) / count
  const epsilon = (max - min) / count / 1000

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      data-variant={variant}
      defaultValue={defaultValue}
      value={value}
      onValueChange={(next) => {
        if (value === undefined) setUncontrolled(next)
        onValueChange?.(next)
      }}
      min={min}
      max={max}
      step={step}
      orientation={orientation}
      inverted={inverted}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-40 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
        variant === "ticks" && "data-[orientation=horizontal]:pb-3 data-[orientation=vertical]:pr-3",
        variant === "segments" && "data-[orientation=horizontal]:py-1 data-[orientation=vertical]:px-1",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className={cn(
          "relative grow rounded-full data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full",
          variant === "segments"
            ? "data-[orientation=horizontal]:h-1.5 data-[orientation=vertical]:w-1.5"
            : "overflow-hidden bg-muted data-[orientation=horizontal]:h-1 data-[orientation=vertical]:w-1"
        )}
      >
        {variant === "segments" ? (
          Array.from({ length: count }, (_, index) => {
            const start = valueAt(index)
            const end = valueAt(index + 1)
            const filled = start >= low - epsilon && end <= high + epsilon
            return (
              <span
                key={index}
                data-slot="slider-segment"
                data-filled={filled || undefined}
                className="absolute rounded-full bg-muted transition-colors data-filled:bg-primary"
                style={{
                  [fromEdge]:
                    index === 0 ? 0 : `calc(${at(index / count)} + 1px)`,
                  [toEdge]:
                    index === count - 1
                      ? 0
                      : `calc(100% - ${at((index + 1) / count)} + 1px)`,
                  ...(isVertical ? { left: 0, right: 0 } : { top: 0, bottom: 0 }),
                }}
              />
            )
          })
        ) : (
          <SliderPrimitive.Range
            data-slot="slider-range"
            className="absolute bg-primary select-none data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
          />
        )}
      </SliderPrimitive.Track>
      {variant === "ticks" && (
        <span
          aria-hidden
          data-slot="slider-ticks"
          className="pointer-events-none absolute inset-0"
        >
          {Array.from({ length: count + 1 }, (_, index) => {
            const mark = valueAt(index)
            const active = mark >= low - epsilon && mark <= high + epsilon
            return (
              <span
                key={index}
                data-slot="slider-tick"
                data-active={active || undefined}
                className={cn(
                  "absolute rounded-full bg-muted-foreground/40 transition-colors data-active:bg-primary",
                  isVertical
                    ? "right-0 h-px w-1.5 translate-y-1/2"
                    : "bottom-0 h-1.5 w-px -translate-x-1/2",
                  isVertical && inverted && "-translate-y-1/2",
                  !isVertical && inverted && "translate-x-1/2"
                )}
                style={{ [fromEdge]: at(index / count) }}
              />
            )
          })}
        </span>
      )}
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          className="relative block size-3 shrink-0 rounded-full border border-ring bg-white ring-ring/50 transition-[color,box-shadow] select-none after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden active:ring-3 disabled:pointer-events-none disabled:opacity-50"
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
export type { SliderProps, SliderVariant }
