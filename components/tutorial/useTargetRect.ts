"use client";

import { useEffect, useState } from "react";

// =====================================================================
// TARGET RECT: where the element marked data-tour="<tourId>" is on
// screen, kept current as the page scrolls, resizes or renders it later
// (screens load their data after the tutorial mounts). null while the
// element is missing or hidden.
// =====================================================================

export type TargetRect = { top: number; left: number; width: number; height: number };

export function useTargetRect(tourId: string): TargetRect | null {
  const [rect, setRect] = useState<TargetRect | null>(null);

  useEffect(() => {
    let frame = 0;
    // Re-measures once per animation frame, however many events fired
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = measure(tourId);
        setRect((previous) => (sameRect(previous, next) ? previous : next));
      });
    };
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [tourId]);

  return rect;
}

// The element's box, or null when it is absent or not laid out (e.g. a hidden sidebar)
function measure(tourId: string): TargetRect | null {
  const element = document.querySelector(`[data-tour="${tourId}"]`);
  if (!element) return null;
  const box = element.getBoundingClientRect();
  if (box.width === 0 && box.height === 0) return null;
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

// True when two boxes are the same to the pixel (avoids re-rendering on every mutation)
function sameRect(a: TargetRect | null, b: TargetRect | null): boolean {
  if (!a || !b) return a === b;
  return Math.round(a.top) === Math.round(b.top) && Math.round(a.left) === Math.round(b.left)
    && Math.round(a.width) === Math.round(b.width) && Math.round(a.height) === Math.round(b.height);
}
