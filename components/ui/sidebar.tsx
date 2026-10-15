"use client"

// SIDEBAR: jayrr.dev registry item "sidebar" (https://jayrr.dev/r/sidebar.json).
// Local changes: `cn` from "@/lib/utils" (one class merger), text-sm -> text-panel (13px scale), data-active only set when active (`data-active:` matches the bare attribute),
// narrower icon rail (2.5rem, one gutter instead of two), SidebarMenuBadge `tone` (attention stays as a count on the icon rail),
// icon rail centres its items with short dividers (via a left inset, not items-center, so collapsing does not jump), xs collapse thumb.

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

import { useIsMobile } from "@/hooks/use-mobile"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PanelLeftIcon,
  SearchIcon,
} from "lucide-react"

const SIDEBAR_COOKIE_NAME = "sidebar_state"
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
const SIDEBAR_WIDTH = "16rem"
const SIDEBAR_WIDTH_MOBILE = "18rem"
const SIDEBAR_WIDTH_ICON = "2.5rem"
const SIDEBAR_KEYBOARD_SHORTCUT = "b"

type SidebarContextProps = {
  state: "expanded" | "collapsed"
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
  searchQuery: string
  setSearchQuery: (query: string) => void
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.")
  }

  return context
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const isMobile = useIsMobile()
  const [openMobile, setOpenMobile] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState("")

  // This is the internal state of the sidebar.
  // We use openProp and setOpenProp for control from outside the component.
  const [_open, _setOpen] = React.useState(defaultOpen)
  const open = openProp ?? _open
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value
      if (setOpenProp) {
        setOpenProp(openState)
      } else {
        _setOpen(openState)
      }

      // This sets the cookie to keep the sidebar state.
      document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`
    },
    [setOpenProp, open]
  )

  // Helper to toggle the sidebar.
  const toggleSidebar = React.useCallback(() => {
    return isMobile ? setOpenMobile((open) => !open) : setOpen((open) => !open)
  }, [isMobile, setOpen, setOpenMobile])

  // Adds a keyboard shortcut to toggle the sidebar.
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault()
        toggleSidebar()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [toggleSidebar])

  // We add a state so that we can do data-state="expanded" or "collapsed".
  // This makes it easier to style the sidebar with Tailwind classes.
  const state = open ? "expanded" : "collapsed"

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      state,
      open,
      setOpen,
      isMobile,
      openMobile,
      setOpenMobile,
      toggleSidebar,
      searchQuery,
      setSearchQuery,
    }),
    [
      state,
      open,
      setOpen,
      isMobile,
      openMobile,
      setOpenMobile,
      toggleSidebar,
      searchQuery,
    ]
  )

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        data-slot="sidebar-wrapper"
        style={
          {
            "--sidebar-width": SIDEBAR_WIDTH,
            "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
            ...style,
          } as React.CSSProperties
        }
        className={cn(
          "group/sidebar-wrapper flex min-h-svh w-full has-data-[variant=inset]:bg-sidebar",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

const collapseThumbSizes = {
  xs: "size-4 [&_svg]:size-3",
  sm: "size-5 [&_svg]:size-3",
  default: "size-6 [&_svg]:size-3.5",
  lg: "size-8 [&_svg]:size-4",
} as const

function Sidebar({
  side = "left",
  variant = "sidebar",
  collapsible = "offcanvas",
  expandOnHover = false,
  collapseThumb = false,
  collapseThumbSize = "default",
  collapseThumbClassName,
  className,
  children,
  dir,
  ...props
}: React.ComponentProps<"div"> & {
  side?: "left" | "right"
  variant?: "sidebar" | "floating" | "inset"
  collapsible?: "offcanvas" | "icon" | "none"
  /** Icon-collapsed sidebars expand over the content while hovered. */
  expandOnHover?: boolean
  /** Round toggle button with an arrow, centered on the sidebar edge. */
  collapseThumb?: boolean
  /** Diameter of the collapse thumb: xs 16px, sm 20px, default 24px, lg 32px. */
  collapseThumbSize?: "xs" | "sm" | "default" | "lg"
  /** Extra classes for the collapse thumb, e.g. to restyle it. */
  collapseThumbClassName?: string
}) {
  const { isMobile, state, openMobile, setOpenMobile, toggleSidebar } =
    useSidebar()
  const [hovered, setHovered] = React.useState(false)
  const hoverExpanded =
    expandOnHover && collapsible === "icon" && state === "collapsed" && hovered

  if (collapsible === "none") {
    return (
      <div
        data-slot="sidebar"
        className={cn(
          "flex h-full w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground",
          className
        )}
        {...props}
      >
        {children}
      </div>
    )
  }

  if (isMobile) {
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
        <SheetContent
          dir={dir}
          data-sidebar="sidebar"
          data-slot="sidebar"
          data-mobile="true"
          className="w-(--sidebar-width) bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden"
          style={
            {
              "--sidebar-width": SIDEBAR_WIDTH_MOBILE,
            } as React.CSSProperties
          }
          side={side}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Sidebar</SheetTitle>
            <SheetDescription>Displays the mobile sidebar.</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div
      className="group peer hidden text-sidebar-foreground md:block"
      data-state={state}
      data-collapsible={
        state === "collapsed" && !hoverExpanded ? collapsible : ""
      }
      data-hover-expanded={hoverExpanded}
      data-variant={variant}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-side={side}
      data-slot="sidebar"
    >
      {/* This is what handles the sidebar gap on desktop */}
      <div
        data-slot="sidebar-gap"
        className={cn(
          "relative w-(--sidebar-width) bg-transparent transition-[width] duration-200 ease-linear",
          "group-data-[collapsible=offcanvas]:w-0",
          "group-data-[side=right]:rotate-180",
          variant === "floating" || variant === "inset"
            ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(2)))] group-data-[hover-expanded=true]:w-[calc(var(--sidebar-width-icon)+(--spacing(2)))]!"
            : "group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[hover-expanded=true]:w-(--sidebar-width-icon)!"
        )}
      />
      <div
        data-slot="sidebar-container"
        data-side={side}
        className={cn(
          "fixed inset-y-0 z-10 hidden h-svh w-(--sidebar-width) transition-[left,right,width] duration-200 ease-linear data-[side=left]:left-0 data-[side=left]:group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)] data-[side=right]:right-0 data-[side=right]:group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)] md:flex",
          // Adjust the padding for floating and inset variants.
          variant === "floating" || variant === "inset"
            ? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(2))+2px)] group-data-[collapsible=icon]:pr-0"
            : "group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[side=left]:border-r group-data-[side=right]:border-l",
          "group-data-[hover-expanded=true]:shadow-lg",
          // Left inset that centres a 2rem button in the icon rail; items stay left-aligned so collapsing does not jump.
          variant === "floating" || variant === "inset"
            ? "[--sidebar-rail-pad:calc((var(--sidebar-width-icon)+2px-2rem)/2)]"
            : "[--sidebar-rail-pad:calc((var(--sidebar-width-icon)-2rem)/2)]",
          className
        )}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          className="flex size-full flex-col bg-sidebar group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:shadow-sm group-data-[variant=floating]:ring-1 group-data-[variant=floating]:ring-sidebar-border"
        >
          {children}
        </div>
        {collapseThumb && (
          <button
            type="button"
            data-slot="sidebar-thumb"
            aria-label="Toggle Sidebar"
            onClick={toggleSidebar}
            className={cn(
              "absolute top-1/2 z-30 flex -translate-y-1/2 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors outline-none group-data-[side=left]:right-0 group-data-[side=left]:translate-x-1/2 group-data-[side=right]:left-0 group-data-[side=right]:-translate-x-1/2 hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              collapseThumbSizes[collapseThumbSize],
              // The icon-collapsed container is 2px wider than its gap in these variants.
              variant === "floating" &&
                "group-data-[collapsible=icon]:group-data-[side=left]:right-0.5 group-data-[collapsible=icon]:group-data-[side=right]:left-0.5",
              // Inset: centre the thumb in the gutter between the sidebar and the inset card.
              variant === "inset" &&
                "group-data-[side=left]:right-1 group-data-[side=right]:left-1 group-data-[collapsible=icon]:group-data-[side=left]:-right-[3px] group-data-[collapsible=icon]:group-data-[side=right]:-left-[3px]",
              collapseThumbClassName
            )}
          >
            {(side === "left") === (state === "expanded") ? (
              <ChevronLeftIcon />
            ) : (
              <ChevronRightIcon />
            )}
          </button>
        )}
      </div>
    </div>
  )
}

function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar()

  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon-sm"
      className={cn(className)}
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      {...props}
    >
      <PanelLeftIcon />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  )
}

function SidebarRail({ className, ...props }: React.ComponentProps<"button">) {
  const { toggleSidebar } = useSidebar()

  return (
    <button
      data-sidebar="rail"
      data-slot="sidebar-rail"
      aria-label="Toggle Sidebar"
      tabIndex={-1}
      onClick={toggleSidebar}
      title="Toggle Sidebar"
      className={cn(
        "absolute inset-y-0 z-20 hidden w-4 transition-all ease-linear group-data-[side=left]:-right-4 group-data-[side=right]:left-0 after:absolute after:inset-y-0 after:start-1/2 after:w-[2px] hover:after:bg-sidebar-border sm:flex ltr:-translate-x-1/2 rtl:-translate-x-1/2",
        "in-data-[side=left]:cursor-w-resize in-data-[side=right]:cursor-e-resize",
        "[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
        "group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full hover:group-data-[collapsible=offcanvas]:bg-sidebar",
        "[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
        "[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
        className
      )}
      {...props}
    />
  )
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn(
        "relative flex w-full flex-1 flex-col bg-background transition-[margin] duration-200 ease-linear md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2",
        className
      )}
      {...props}
    />
  )
}

function SidebarInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  return (
    <Input
      data-slot="sidebar-input"
      data-sidebar="input"
      className={cn("h-8 w-full bg-background shadow-none", className)}
      {...props}
    />
  )
}

// Built-in hairline drawn inside the section's horizontal padding.
const separatorLine = {
  top: "relative before:absolute before:inset-x-2 before:top-0 before:h-px before:bg-sidebar-border group-data-[collapsible=icon]:before:inset-x-[calc(50%-0.625rem)]",
  bottom:
    "relative after:absolute after:inset-x-2 after:bottom-0 after:h-px after:bg-sidebar-border group-data-[collapsible=icon]:after:inset-x-[calc(50%-0.625rem)]",
}

type SidebarSeparatorProp = { separator?: boolean }

function SidebarSearch({
  placeholder = "Search...",
}: {
  placeholder?: string
}) {
  const { searchQuery, setSearchQuery, state, setOpen, isMobile } = useSidebar()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const focusOnExpand = React.useRef(false)
  const iconCollapsed = state === "collapsed" && !isMobile

  React.useEffect(() => {
    if (!iconCollapsed && focusOnExpand.current) {
      focusOnExpand.current = false
      inputRef.current?.focus()
    }
  }, [iconCollapsed])

  // In the icon rail the field becomes a button that opens the sidebar.
  if (iconCollapsed) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip="Search"
            onClick={() => {
              focusOnExpand.current = true
              setOpen(true)
            }}
          >
            <SearchIcon />
            <span>Search</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  return (
    <div data-slot="sidebar-search" className="relative">
      <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <SidebarInput
        ref={inputRef}
        type="search"
        aria-label={placeholder}
        placeholder={placeholder}
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setSearchQuery("")
        }}
        className="ps-8"
      />
    </div>
  )
}

function SidebarHeader({
  className,
  separator = false,
  search = false,
  searchPlaceholder,
  children,
  ...props
}: React.ComponentProps<"div"> &
  SidebarSeparatorProp & {
    /** Adds a search field that filters menu items by their text. */
    search?: boolean
    searchPlaceholder?: string
  }) {
  return (
    <div
      data-slot="sidebar-header"
      data-sidebar="header"
      className={cn(
        "flex flex-col gap-2 p-2 transition-[padding] duration-200 ease-linear group-data-[collapsible=icon]:px-(--sidebar-rail-pad)",
        separator && separatorLine.bottom,
        className
      )}
      {...props}
    >
      {children}
      {search && <SidebarSearch placeholder={searchPlaceholder} />}
    </div>
  )
}

function SidebarFooter({
  className,
  separator = false,
  ...props
}: React.ComponentProps<"div"> & SidebarSeparatorProp) {
  return (
    <div
      data-slot="sidebar-footer"
      data-sidebar="footer"
      className={cn(
        "flex flex-col gap-2 p-2 transition-[padding] duration-200 ease-linear group-data-[collapsible=icon]:px-(--sidebar-rail-pad)",
        separator && separatorLine.top,
        className
      )}
      {...props}
    />
  )
}

function SidebarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="sidebar-separator"
      data-sidebar="separator"
      className={cn("mx-2 w-auto bg-sidebar-border", className)}
      {...props}
    />
  )
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        "no-scrollbar flex min-h-0 flex-1 flex-col gap-0 overflow-auto group-data-[collapsible=icon]:overflow-hidden",
        className
      )}
      {...props}
    />
  )
}

const SidebarGroupContext = React.createContext<{
  collapsible: boolean
} | null>(null)

function SidebarGroup({
  className,
  separator = false,
  collapsible = false,
  defaultOpen = true,
  ...props
}: React.ComponentProps<"div"> &
  SidebarSeparatorProp & {
    /** Turns the label into a toggle that folds the group's content. */
    collapsible?: boolean
    /** Initial open state when `collapsible` is set. */
    defaultOpen?: boolean
  }) {
  const { state, isMobile, searchQuery } = useSidebar()
  const [open, setOpen] = React.useState(defaultOpen)
  const groupRef = React.useRef<HTMLDivElement>(null)

  // Children's effects run first, so their hidden state is already settled.
  React.useLayoutEffect(() => {
    const element = groupRef.current
    if (!element) return
    const items = element.querySelectorAll("[data-sidebar=menu-item]")
    element.hidden =
      searchQuery.trim() !== "" &&
      items.length > 0 &&
      !element.querySelector("[data-sidebar=menu-item]:not([hidden])")
  })
  const groupClassName = cn(
    "relative flex w-full min-w-0 flex-col p-2 transition-[padding] duration-200 ease-linear group-data-[collapsible=icon]:px-(--sidebar-rail-pad)",
    separator && separatorLine.top,
    className
  )

  if (!collapsible) {
    return (
      <div
        ref={groupRef}
        data-slot="sidebar-group"
        data-sidebar="group"
        className={groupClassName}
        {...props}
      />
    )
  }

  // Icon-collapsed rails always show every item.
  const iconCollapsed = state === "collapsed" && !isMobile

  return (
    <SidebarGroupContext.Provider value={{ collapsible: true }}>
      <Collapsible asChild open={iconCollapsed || open} onOpenChange={setOpen}>
        <div
          ref={groupRef}
          data-slot="sidebar-group"
          data-sidebar="group"
          className={cn("group/sidebar-group", groupClassName)}
          {...props}
        />
      </Collapsible>
    </SidebarGroupContext.Provider>
  )
}

function SidebarGroupLabel({
  className,
  asChild = false,
  children,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const group = React.useContext(SidebarGroupContext)
  const Comp = asChild ? Slot.Root : "div"

  if (group?.collapsible && !asChild) {
    return (
      <CollapsibleTrigger
        data-slot="sidebar-group-label"
        data-sidebar="group-label"
        className={cn(
          sidebarGroupLabelClassName,
          "w-full cursor-pointer text-start group-data-[collapsible=icon]:pointer-events-none hover:text-sidebar-foreground",
          className
        )}
        {...(props as React.ComponentProps<"button">)}
      >
        {children}
        <ChevronRightIcon className="ms-auto transition-transform group-data-[state=open]/sidebar-group:rotate-90" />
      </CollapsibleTrigger>
    )
  }

  return (
    <Comp
      data-slot="sidebar-group-label"
      data-sidebar="group-label"
      className={cn(sidebarGroupLabelClassName, className)}
      {...props}
    >
      {children}
    </Comp>
  )
}

const sidebarGroupLabelClassName =
  "flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium whitespace-nowrap text-sidebar-foreground/70 ring-sidebar-ring outline-hidden transition-[margin,opacity] duration-200 ease-linear group-data-[collapsible=icon]:overflow-hidden group-data-[collapsible=icon]:text-transparent group-data-[collapsible=icon]:[&>*]:opacity-0 focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0"

function SidebarGroupAction({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="sidebar-group-action"
      data-sidebar="group-action"
      className={cn(
        "absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground ring-sidebar-ring outline-hidden transition-transform group-data-[collapsible=icon]:hidden after:absolute after:-inset-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 md:after:hidden [&>svg]:size-4 [&>svg]:shrink-0",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroupContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const group = React.useContext(SidebarGroupContext)
  const content = (
    <div
      data-slot="sidebar-group-content"
      data-sidebar="group-content"
      className={cn("w-full text-panel", className)}
      {...props}
    />
  )

  return group?.collapsible ? (
    <CollapsibleContent>{content}</CollapsibleContent>
  ) : (
    content
  )
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className={cn("flex w-full min-w-0 flex-col gap-1", className)}
      {...props}
    />
  )
}

function SidebarMenuItem({
  className,
  ref: forwardedRef,
  ...props
}: React.ComponentProps<"li">) {
  const { searchQuery } = useSidebar()
  const ref = React.useRef<HTMLLIElement | null>(null)

  React.useLayoutEffect(() => {
    const query = searchQuery.trim().toLowerCase()
    const element = ref.current
    if (!element) return
    element.hidden =
      query !== "" && !element.textContent?.toLowerCase().includes(query)
  })

  return (
    <li
      ref={(node) => {
        ref.current = node
        if (typeof forwardedRef === "function") forwardedRef(node)
        else if (forwardedRef) forwardedRef.current = node
      }}
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn("group/menu-item relative", className)}
      {...props}
    />
  )
}

const sidebarMenuButtonVariants = cva(
  "peer/menu-button group/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-panel ring-sidebar-ring outline-hidden transition-[width,height,padding] duration-200 ease-linear group-has-data-[sidebar=menu-action]/menu-item:pr-8 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-open:hover:bg-sidebar-accent data-open:hover:text-sidebar-accent-foreground data-active:bg-sidebar-accent data-active:font-medium data-active:text-sidebar-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&>span:last-child]:truncate",
  {
    variants: {
      variant: {
        default: "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        outline:
          "bg-background shadow-[0_0_0_1px_var(--sidebar-border)] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_var(--sidebar-accent)]",
      },
      size: {
        default: "h-8 text-panel",
        sm: "h-7 text-xs",
        lg: "h-12 text-panel group-data-[collapsible=icon]:p-0!",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function SidebarMenuButton({
  asChild = false,
  isActive = false,
  variant = "default",
  size = "default",
  tooltip,
  className,
  ...props
}: React.ComponentProps<"button"> & {
  asChild?: boolean
  isActive?: boolean
  tooltip?: string | React.ComponentProps<typeof TooltipContent>
} & VariantProps<typeof sidebarMenuButtonVariants>) {
  const Comp = asChild ? Slot.Root : "button"
  const { isMobile, state } = useSidebar()

  const button = (
    <Comp
      data-slot="sidebar-menu-button"
      data-sidebar="menu-button"
      data-size={size}
      data-active={isActive || undefined}
      className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
      {...props}
    />
  )

  if (!tooltip) {
    return button
  }

  if (typeof tooltip === "string") {
    tooltip = {
      children: tooltip,
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side="right"
        align="center"
        hidden={state !== "collapsed" || isMobile}
        {...tooltip}
      />
    </Tooltip>
  )
}

function SidebarMenuAction({
  className,
  asChild = false,
  showOnHover = false,
  ...props
}: React.ComponentProps<"button"> & {
  asChild?: boolean
  showOnHover?: boolean
}) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="sidebar-menu-action"
      data-sidebar="menu-action"
      className={cn(
        "absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground ring-sidebar-ring outline-hidden transition-transform group-data-[collapsible=icon]:hidden peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[size=default]/menu-button:top-1.5 peer-data-[size=lg]/menu-button:top-2.5 peer-data-[size=sm]/menu-button:top-1 after:absolute after:-inset-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 md:after:hidden [&>svg]:size-4 [&>svg]:shrink-0",
        showOnHover &&
          "group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 peer-data-active/menu-button:text-sidebar-accent-foreground aria-expanded:opacity-100 md:opacity-0",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuBadge({
  className,
  tone = "default",
  ...props
}: React.ComponentProps<"div"> & {
  /** "attention" colors the count with the needs-you accent. */
  tone?: "default" | "attention"
}) {
  return (
    <div
      data-slot="sidebar-menu-badge"
      data-sidebar="menu-badge"
      className={cn(
        "pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium text-sidebar-foreground tabular-nums select-none group-data-[collapsible=icon]:hidden peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[size=default]/menu-button:top-1.5 peer-data-[size=lg]/menu-button:top-2.5 peer-data-[size=sm]/menu-button:top-1 peer-data-active/menu-button:text-sidebar-accent-foreground",
        tone === "attention" && "text-needs-you peer-hover/menu-button:text-needs-you peer-data-active/menu-button:text-needs-you group-data-[collapsible=icon]:-top-0.5! group-data-[collapsible=icon]:-right-0.5 group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:h-3.5 group-data-[collapsible=icon]:min-w-3.5 group-data-[collapsible=icon]:rounded-full group-data-[collapsible=icon]:bg-needs-you group-data-[collapsible=icon]:px-1 group-data-[collapsible=icon]:font-mono group-data-[collapsible=icon]:leading-3.5 group-data-[collapsible=icon]:font-normal group-data-[collapsible=icon]:text-background!",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuSkeleton({
  className,
  showIcon = false,
  ...props
}: React.ComponentProps<"div"> & {
  showIcon?: boolean
}) {
  // Random width between 50 to 90%.
  const [width] = React.useState(() => {
    return `${Math.floor(Math.random() * 40) + 50}%`
  })

  return (
    <div
      data-slot="sidebar-menu-skeleton"
      data-sidebar="menu-skeleton"
      className={cn("flex h-8 items-center gap-2 rounded-md px-2", className)}
      {...props}
    >
      {showIcon && (
        <Skeleton
          className="size-4 rounded-md"
          data-sidebar="menu-skeleton-icon"
        />
      )}
      <Skeleton
        className="h-4 max-w-(--skeleton-width) flex-1"
        data-sidebar="menu-skeleton-text"
        style={
          {
            "--skeleton-width": width,
          } as React.CSSProperties
        }
      />
    </div>
  )
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu-sub"
      data-sidebar="menu-sub"
      className={cn(
        "mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5 group-data-[collapsible=icon]:hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuSubItem({
  className,
  ...props
}: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-sub-item"
      data-sidebar="menu-sub-item"
      className={cn("group/menu-sub-item relative", className)}
      {...props}
    />
  )
}

function SidebarMenuSubButton({
  asChild = false,
  size = "md",
  isActive = false,
  className,
  ...props
}: React.ComponentProps<"a"> & {
  asChild?: boolean
  size?: "sm" | "md"
  isActive?: boolean
}) {
  const Comp = asChild ? Slot.Root : "a"

  return (
    <Comp
      data-slot="sidebar-menu-sub-button"
      data-sidebar="menu-sub-button"
      data-size={size}
      data-active={isActive || undefined}
      className={cn(
        "flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 text-sidebar-foreground ring-sidebar-ring outline-hidden group-data-[collapsible=icon]:hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[size=md]:text-panel data-[size=sm]:text-xs data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
}
