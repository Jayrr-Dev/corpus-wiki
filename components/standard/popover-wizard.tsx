"use client";

// POPOVER WIZARD: standardsui registry item "popover-wizard"
// (https://standardsui.com/r/popover-wizard.json).
// Local changes: the app Button, no motion classes, Tooltip on the dots
// instead of a native title.

import { Tooltip } from "@/components/standard/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useState, type ReactNode } from "react";

export type PopoverWizardStep = {
  id: string;
  /** Shown in the header while this step is open. */
  title?: string;
  content: ReactNode;
};

const WIDTH_CLASS = {
  sm: "w-64",
  md: "w-80",
} as const;

type PopoverWizardWidth = keyof typeof WIDTH_CLASS;

function nextLabelFor(
  steps: readonly PopoverWizardStep[],
  stepIndex: number,
  completeLabel: string,
) {
  if (stepIndex === steps.length - 1) return completeLabel;
  return steps[stepIndex + 1]?.title?.trim() || "Next";
}

/**
 * Small multi-step panel anchored to its trigger. One step at a time,
 * with dots in the header and Back / Next along the bottom.
 */
export function PopoverWizard({
  steps,
  trigger,
  open: openProp,
  onOpenChange,
  defaultOpen = false,
  completeLabel = "Got it",
  backLabel = "Back",
  dots = true,
  jumpFromDots = false,
  width = "md",
  side = "bottom",
  align = "start",
  sideOffset = 8,
  className,
}: {
  steps: readonly PopoverWizardStep[];
  trigger: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  completeLabel?: string;
  backLabel?: string;
  dots?: boolean;
  /** A click on a dot jumps to that step. */
  jumpFromDots?: boolean;
  width?: PopoverWizardWidth;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  className?: string;
}) {
  const [openState, setOpenState] = useState(defaultOpen);
  const [stepIndex, setStepIndex] = useState(0);
  const open = openProp ?? openState;
  const current = steps[stepIndex];
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex >= steps.length - 1;
  const heading = current?.title;

  function setOpen(next: boolean) {
    setOpenState(next);
    onOpenChange?.(next);
    if (!next) setStepIndex(0);
  }

  function goNext() {
    if (isLastStep) {
      setOpen(false);
      return;
    }
    setStepIndex(stepIndex + 1);
  }

  function goBack() {
    if (isFirstStep) return;
    setStepIndex(stepIndex - 1);
  }

  function goTo(target: number) {
    if (target < 0 || target >= steps.length || target === stepIndex) return;
    setStepIndex(target);
  }

  const dotRow =
    dots && steps.length > 1 ? (
      <div
        role="group"
        aria-label={`Step ${stepIndex + 1} of ${steps.length}`}
        className="flex shrink-0 items-center gap-0.5"
      >
        {steps.map((step, index) => {
          const isActive = index === stepIndex;
          const label = step.title || `Step ${index + 1}`;
          const dot = (
            <span
              aria-hidden
              className={cn(
                "block size-1.5 rounded-full",
                isActive ? "bg-foreground" : "bg-muted-foreground/40",
              )}
            />
          );
          if (!jumpFromDots) {
            return (
              <span key={step.id} className="p-1">
                {dot}
              </span>
            );
          }
          return (
            <Tooltip key={step.id} content={label} side="top">
              <button
                type="button"
                aria-label={`Go to ${label}`}
                aria-current={isActive ? "step" : undefined}
                onClick={() => goTo(index)}
                className="rounded-full p-1 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {dot}
              </button>
            </Tooltip>
          );
        })}
      </div>
    ) : null;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          data-slot="popover-wizard"
          data-step={current?.id}
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={16}
          aria-label={heading ?? "Guide"}
          className={cn(
            "z-50 flex max-h-[min(85dvh,32rem)] origin-(--radix-popover-content-transform-origin) flex-col gap-2.5 rounded-lg bg-popover p-3 text-panel text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden",
            WIDTH_CLASS[width],
            className,
          )}
        >
          <div className="flex items-center gap-2">
            {heading ? (
              <p className="min-w-0 flex-1 truncate font-medium text-foreground">
                {heading}
              </p>
            ) : (
              <span className="flex-1" />
            )}
            {dotRow}
            <PopoverPrimitive.Close
              aria-label="Close"
              className="-mt-1 -mr-1 shrink-0 rounded-md p-1 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <X className="size-3.5" />
            </PopoverPrimitive.Close>
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain leading-relaxed text-muted-foreground">
            {current?.content}
          </div>
          <div
            className={cn(
              "flex items-center gap-2",
              isFirstStep ? "justify-end" : "justify-between",
            )}
          >
            {isFirstStep ? null : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={goBack}
              >
                <ChevronLeft />
                {backLabel}
              </Button>
            )}
            <Button type="button" size="sm" onClick={goNext}>
              {nextLabelFor(steps, stepIndex, completeLabel)}
              {isLastStep ? null : <ChevronRight />}
            </Button>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
