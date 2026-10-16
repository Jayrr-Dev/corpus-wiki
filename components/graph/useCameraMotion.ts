"use client";

import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import type { Camera } from "@/lib/graph/camera";

export function useCameraMotion(cameraRef: RefObject<Camera>, redraw: () => void) {
  const frame = useRef<number | null>(null);
  const target = useRef<Camera | null>(null);
  const cancel = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    target.current = null;
  }, []);
  const animateTo = useCallback((next: Camera, onComplete?: () => void) => {
    cancel();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      cameraRef.current = next;
      onComplete?.();
      redraw();
      return;
    }
    target.current = next;
    const from = { ...cameraRef.current };
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 320);
      const eased = 1 - (1 - t) ** 3;
      cameraRef.current = {
        x: from.x + (next.x - from.x) * eased,
        y: from.y + (next.y - from.y) * eased,
        k: from.k + (next.k - from.k) * eased,
      };
      redraw();
      if (t < 1) frame.current = requestAnimationFrame(step);
      else { frame.current = null; target.current = null; onComplete?.(); }
    };
    frame.current = requestAnimationFrame(step);
  }, [cameraRef, cancel, redraw]);
  useEffect(() => cancel, [cancel]);
  return useMemo(() => ({ animateTo, cancel, target }), [animateTo, cancel]);
}

