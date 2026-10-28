"use client"

// DIALOG: the app dialog, with the Standards UI window buttons
// (minimize, maximize, close) from https://standardsui.com/r/standard-dialog.json.
// Local changes: same compound parts as before (DialogContent, DialogTitle, …).
// The dim layer is omitted while minimized, so the page stays usable.
// `cn` from "@/lib/utils". text-panel / text-body scale. No tw-animate-css motion classes.

import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"
import { Dialog as DialogPrimitive } from "radix-ui"
import { CircleMinus, CircleStop, CircleX, Maximize2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/standard/tooltip"

const DIALOG_DOCK_ID = "standard-dialog-dock"

const DIALOG_DOCK_CLASS =
  "pointer-events-none fixed right-3 bottom-3 z-50 flex flex-col-reverse items-end gap-2"

const DIALOG_CONTROL_CLASS =
  "group inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground opacity-70 transition-opacity outline-none hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"

const DIALOG_CONTROL_ICON_CLASS = "pointer-events-none size-4 transition-colors"

type DialogWindow = {
  minimized: boolean
  maximized: boolean
  minimize: () => void
  toggleMaximized: () => void
  setLabel: (label: string) => void
}

const DialogWindowContext = React.createContext<DialogWindow | null>(null)

// One shared corner dock, so minimized dialogs stack without a provider.
// Created on the first minimize (an event, so never during render or SSR).
function ensuresDialogDock() {
  let node = document.getElementById(DIALOG_DOCK_ID)
  if (!node) {
    node = document.createElement("div")
    node.id = DIALOG_DOCK_ID
    node.className = DIALOG_DOCK_CLASS
    document.body.appendChild(node)
  }
  return node
}

function Dialog({
  modal = true,
  open,
  onOpenChange,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const [minimized, setMinimized] = React.useState(false)
  const [maximized, setMaximized] = React.useState(false)
  const [label, setLabelState] = React.useState("Dialog")
  const [dock, setDock] = React.useState<HTMLElement | null>(null)
  const [previousOpen, setPreviousOpen] = React.useState(open)

  // A parent closing a controlled dialog also clears the window state.
  if (open !== previousOpen) {
    setPreviousOpen(open)
    if (open === false) {
      setMinimized(false)
      setMaximized(false)
    }
  }

  const setLabel = React.useCallback((next: string) => {
    setLabelState((current) => (current === next ? current : next))
  }, [])

  const minimize = React.useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    setDock(ensuresDialogDock())
    setMinimized(true)
  }, [])

  const toggleMaximized = React.useCallback(() => {
    setMaximized((current) => !current)
  }, [])

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setMinimized(false)
      setMaximized(false)
    }
    onOpenChange?.(next)
  }

  const window = React.useMemo<DialogWindow>(
    () => ({ minimized, maximized, minimize, toggleMaximized, setLabel }),
    [minimized, maximized, minimize, toggleMaximized, setLabel]
  )

  return (
    <DialogWindowContext.Provider value={window}>
      <DialogPrimitive.Root
        data-slot="dialog"
        modal={modal && !minimized}
        open={open}
        onOpenChange={handleOpenChange}
        {...props}
      >
        {children}
      </DialogPrimitive.Root>
      {minimized && dock
        ? createPortal(
            <Tooltip content={label}>
              <button
                type="button"
                aria-label={`Restore dialog: ${label}`}
                onClick={() => setMinimized(false)}
                className="pointer-events-auto flex h-8 max-w-44 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-background px-3 text-xs font-medium text-foreground shadow-md transition-shadow outline-none hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Maximize2 aria-hidden className="size-3 shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            </Tooltip>,
            dock
          )
        : null}
    </DialogWindowContext.Provider>
  )
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-background/60 duration-100 supports-backdrop-filter:backdrop-blur-xs",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  motion = false,
  onEscapeKeyDown,
  onInteractOutside,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  motion?: boolean
}) {
  const window = React.useContext(DialogWindowContext)
  const minimized = window?.minimized ?? false
  const maximized = window?.maximized ?? false

  return (
    <DialogPortal>
      {minimized ? null : <DialogOverlay />}
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-maximized={maximized ? "" : undefined}
        data-minimized={minimized ? "" : undefined}
        inert={minimized || undefined}
        onEscapeKeyDown={(event) => {
          if (minimized) event.preventDefault()
          onEscapeKeyDown?.(event)
        }}
        onInteractOutside={(event) => {
          if (minimized) event.preventDefault()
          onInteractOutside?.(event)
        }}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-full min-w-72 max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-xl bg-popover text-panel text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm",
          motion && "dialog-menu-motion",
          showCloseButton && "[&_[data-slot=dialog-header]]:pr-20",
          className,
          maximized &&
            "top-0 left-0 h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 rounded-none sm:max-w-none",
          minimized && "pointer-events-none invisible",
          "p-0"
        )}
        {...props}
      >
        <div
          data-slot="dialog-body"
          className={cn(
            "flex w-full flex-col gap-4 p-4",
            "has-[[data-slot=dialog-footer]]:pb-0",
            "in-data-[maximized]:min-h-full in-data-[maximized]:flex-1",
            "in-data-[maximized]:has-[[data-slot=dialog-footer]]:[&>:has([data-slot=dialog-footer])]:flex",
            "in-data-[maximized]:has-[[data-slot=dialog-footer]]:[&>:has([data-slot=dialog-footer])]:min-h-full",
            "in-data-[maximized]:has-[[data-slot=dialog-footer]]:[&>:has([data-slot=dialog-footer])]:w-full",
            "in-data-[maximized]:has-[[data-slot=dialog-footer]]:[&>:has([data-slot=dialog-footer])]:flex-1",
            "in-data-[maximized]:has-[[data-slot=dialog-footer]]:[&>:has([data-slot=dialog-footer])]:flex-col",
            "[&_:has(>[data-slot=dialog-footer])]:mt-auto",
            "[&_:has(>[data-slot=dialog-footer])]:flex",
            "[&_:has(>[data-slot=dialog-footer])]:w-full",
            "[&_:has(>[data-slot=dialog-footer])]:flex-col"
          )}
        >
          {children}
        </div>
        {showCloseButton && window ? (
          <div
            data-slot="dialog-controls"
            className="absolute top-2 right-2 flex items-center"
          >
            <button
              type="button"
              aria-label="Minimize"
              className={DIALOG_CONTROL_CLASS}
              onClick={window.minimize}
            >
              <CircleMinus
                aria-hidden
                className={cn(DIALOG_CONTROL_ICON_CLASS, "group-hover:text-info")}
              />
            </button>
            <button
              type="button"
              aria-label={maximized ? "Restore" : "Maximize"}
              aria-pressed={maximized}
              className={DIALOG_CONTROL_CLASS}
              onClick={window.toggleMaximized}
            >
              <CircleStop
                aria-hidden
                className={cn(DIALOG_CONTROL_ICON_CLASS, "group-hover:text-info")}
              />
            </button>
            <DialogPrimitive.Close aria-label="Close" className={DIALOG_CONTROL_CLASS}>
              <CircleX
                aria-hidden
                className={cn(
                  DIALOG_CONTROL_ICON_CLASS,
                  "group-hover:text-destructive"
                )}
              />
            </DialogPrimitive.Close>
          </div>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "sticky bottom-0 z-10 -mx-4 mt-auto flex shrink-0 flex-col-reverse gap-2 border-t bg-muted p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  const window = React.useContext(DialogWindowContext)
  const ref = React.useRef<HTMLHeadingElement>(null)

  React.useLayoutEffect(() => {
    window?.setLabel(ref.current?.textContent?.trim() || "Dialog")
  })

  return (
    <DialogPrimitive.Title
      ref={ref}
      data-slot="dialog-title"
      className={cn("text-body leading-none font-medium", className)}
      {...props}
    >
      {children}
    </DialogPrimitive.Title>
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-panel text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
