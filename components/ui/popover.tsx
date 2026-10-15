"use client"

// POPOVER: jayrr.dev registry item "popover" (https://jayrr.dev/r/popover.json).
// Local changes: `cn` from "@/lib/utils" (one class merger), text-sm -> text-panel (13px scale), no tw-animate-css motion classes.

import * as React from "react"
import { cn } from "@/lib/utils"
import { Popover as PopoverPrimitive } from "radix-ui"

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

type PopoverContentVariant = "default" | "arrow" | "tooltip"

const popoverContentVariantClassNames: Record<PopoverContentVariant, string> = {
  default:
    "w-72 gap-2.5 rounded-lg bg-popover p-2.5 text-panel text-popover-foreground shadow-md ring-1 ring-foreground/10",
  arrow:
    "w-72 gap-2.5 rounded-lg border border-foreground/10 bg-popover p-2.5 text-panel text-popover-foreground shadow-md",
  tooltip:
    "w-fit max-w-xs gap-1 rounded-md bg-foreground px-3 py-1.5 text-xs text-background",
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  variant = "default",
  side,
  children,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
  variant?: PopoverContentVariant
}) {
  // The tooltip variant reads as a callout, so it points down at the trigger
  // unless a side is asked for.
  const resolvedSide = side ?? (variant === "tooltip" ? "top" : undefined)

  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        data-variant={variant}
        align={align}
        side={resolvedSide}
        sideOffset={sideOffset}
        className={cn(
          "z-50 flex origin-(--radix-popover-content-transform-origin) flex-col outline-hidden",
          popoverContentVariantClassNames[variant],
          className
        )}
        {...props}
      >
        {children}
        {variant === "tooltip" ? (
          <PopoverPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground" />
        ) : null}
        {variant === "arrow" ? (
          // Radix rotates the arrow wrapper per side, so the caret is always
          // drawn pointing down: only its bottom two edges need a border.
          <PopoverPrimitive.Arrow asChild>
            <span className="z-50 block size-2.5 translate-y-[calc(-50%_-_1px)] rotate-45 rounded-br-[2px] border-r border-b border-foreground/10 bg-popover" />
          </PopoverPrimitive.Arrow>
        ) : null}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-0.5 text-panel", className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <div
      data-slot="popover-title"
      className={cn("font-medium", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
