"use client";

import type { CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Placement } from "./placement";
import type { TutorialStep } from "./steps";

type TutorialPopoverProps = {
  step: TutorialStep;
  stepIndex: number;
  stepCount: number;
  hint: string;
  // Next to its target with an arrow; null = floating in the corner (target not on screen)
  placement: Placement | null;
  onStep: (index: number) => void;
  onClose: () => void;
};

// POPOVER: step count, title, what to do, Back / Next, and an arrow at the target
export function TutorialPopover({ step, stepIndex, stepCount, hint, placement, onStep, onClose }: TutorialPopoverProps) {
  const isLast = stepIndex === stepCount - 1;
  return (
    <aside
      aria-label="Tutorial"
      style={
        {
          "--tour-x": `${placement?.x ?? 0}px`,
          "--tour-y": `${placement?.y ?? 0}px`,
          "--tour-arrow": `${(placement?.arrowOffset ?? 0) - 6}px`,
        } as CSSProperties
      }
      className={cn("fixed z-40 flex w-72 flex-col gap-2 rounded-md border bg-background p-3 shadow-lg", placementClass(placement))}
    >
      {placement ? <Arrow placement={placement} /> : null}
      <div className="flex items-center justify-between text-panel text-faint">
        <span>
          Step {stepIndex + 1} of {stepCount}
        </span>
        <Button type="button" size="icon-xs" variant="ghost" onClick={onClose} aria-label="Close tutorial">
          ×
        </Button>
      </div>
      <h2 className="text-body font-semibold">{step.title}</h2>
      <p className="text-panel text-muted-foreground">{step.body}</p>
      <p className="text-panel font-medium">{hint}</p>
      <div className="flex justify-end gap-2">
        {stepIndex > 0 ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => onStep(stepIndex - 1)}>
            Back
          </Button>
        ) : null}
        <Button type="button" size="sm" variant={isLast ? "default" : "outline"} onClick={() => onStep(stepIndex + 1)}>
          {isLast ? "Done" : "Skip step"}
        </Button>
      </div>
    </aside>
  );
}

// Corner when floating; otherwise beside, below or above the target
function placementClass(placement: Placement | null): string {
  if (!placement) return "right-4 bottom-4";
  const bySide: Record<Placement["side"], string> = {
    right: "top-(--tour-y) left-(--tour-x)",
    bottom: "top-(--tour-y) left-(--tour-x)",
    top: "bottom-(--tour-y) left-(--tour-x)",
  };
  return bySide[placement.side];
}

// ARROW: a small rotated square on the edge facing the target, bordered on its two outer sides
function Arrow({ placement }: { placement: Placement }) {
  const bySide: Record<Placement["side"], string> = {
    right: "top-(--tour-arrow) -left-1.5 border-b border-l",
    bottom: "-top-1.5 left-(--tour-arrow) border-t border-l",
    top: "-bottom-1.5 left-(--tour-arrow) border-r border-b",
  };
  return <span aria-hidden className={cn("absolute size-3 rotate-45 bg-background", bySide[placement.side])} />;
}
