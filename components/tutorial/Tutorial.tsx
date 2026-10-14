"use client";

import { usePathname } from "next/navigation";
import { type CSSProperties, useSyncExternalStore } from "react";
import { placePopover } from "./placement";
import { TUTORIAL_STEPS } from "./steps";
import { closeTutorial, goToStep, useTutorialState } from "./tutorialStore";
import { type TargetRect, useTargetRect } from "./useTargetRect";
import { TutorialPopover } from "./TutorialPopover";

// =====================================================================
// TUTORIAL: walks a first-time user through the app by pointing at the
// real controls. Each step outlines its target on the current screen
// (or the nav item that leads there) and anchors a popover to it. Doing
// the step's action moves the tour on; closing it is remembered. The
// "?" button in the ribbon (components/shell/Ribbon.tsx) reopens it.
// =====================================================================

const SPOTLIGHT_PADDING = 4;

export function Tutorial() {
  const { isOpen, stepIndex } = useTutorialState();
  if (!isOpen) return null;
  return <ActiveStep stepIndex={stepIndex} />;
}

// THE CURRENT STEP: target outline plus the popover next to it
function ActiveStep({ stepIndex }: { stepIndex: number }) {
  const pathname = usePathname();
  const step = TUTORIAL_STEPS[stepIndex];
  const target = step?.targetFor(pathname);
  const rect = useTargetRect(target?.tourId ?? "");
  const viewport = useViewportSize();
  if (!step || !target) return null;
  const placement = rect && viewport ? placePopover(rect, viewport) : null;
  return (
    <>
      {rect ? <Spotlight rect={rect} /> : null}
      <TutorialPopover
        step={step}
        stepIndex={stepIndex}
        stepCount={TUTORIAL_STEPS.length}
        hint={target.hint}
        placement={placement}
        onStep={goToStep}
        onClose={closeTutorial}
      />
    </>
  );
}

// SPOTLIGHT: an outline around the real element; clicks pass through to it
function Spotlight({ rect }: { rect: TargetRect }) {
  const vars = {
    "--spot-top": `${rect.top - SPOTLIGHT_PADDING}px`,
    "--spot-left": `${rect.left - SPOTLIGHT_PADDING}px`,
    "--spot-width": `${rect.width + SPOTLIGHT_PADDING * 2}px`,
    "--spot-height": `${rect.height + SPOTLIGHT_PADDING * 2}px`,
  } as CSSProperties;
  return (
    <div
      aria-hidden
      style={vars}
      className="pointer-events-none fixed top-(--spot-top) left-(--spot-left) z-40 h-(--spot-height) w-(--spot-width) rounded-md ring-2 ring-link transition-all"
    />
  );
}

// =====================================================================
// VIEWPORT SIZE (for placement), live on resize; null during server render
// =====================================================================

let viewportCache: { width: number; height: number } | null = null;

function useViewportSize(): { width: number; height: number } | null {
  return useSyncExternalStore(subscribeResize, readViewport, () => null);
}

// Re-reads on window resize
function subscribeResize(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

// The same object until the size changes (useSyncExternalStore needs a stable snapshot)
function readViewport(): { width: number; height: number } {
  const { innerWidth: width, innerHeight: height } = window;
  if (viewportCache?.width !== width || viewportCache.height !== height) viewportCache = { width, height };
  return viewportCache;
}
