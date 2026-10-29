"use client";
/* eslint-disable shadcn/no-inline-styles -- stage frames compute every position, scale and opacity from t */

import { useEffect, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { FRAME_HEIGHT, FRAME_WIDTH } from "@/components/video-stage/scene";
import { SCENES } from "../scenes";

// The pause at the end of each loop before it starts again (seconds)
const HOLD = 0.8;

declare global {
  interface Window {
    SCENE?: { duration: number; frame: (t: number) => void };
    __ready?: boolean;
  }
}

// Motion comes only from t, so frames are exact; the frame never scrolls; the dev
// tools badge stays out of shots; viewport-tall shell parts are frame-tall instead
const STAGE_CSS = `
html, body { overflow: hidden !important; background: #000; }
*, *::before, *::after { transition: none !important; animation: none !important; }
nextjs-portal { display: none !important; }
[data-stage-frame] .h-dvh, [data-stage-frame] .h-svh { height: ${FRAME_HEIGHT}px !important; }
[data-stage-frame] .min-h-svh, [data-stage-frame] .min-h-dvh { min-height: ${FRAME_HEIGHT}px !important; }
`;

const noop = () => () => {};

// Scale that fits the frame in the window (1 in the renderer's 1920x1080 viewport)
function subscribeResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}
const readFit = () => Math.min(window.innerWidth / FRAME_WIDTH, window.innerHeight / FRAME_HEIGHT);

type Mode = "loop" | "render" | "still";

// STAGE RUNNER: owns t and draws the scene at it
export function StageRunner({ id, mode, still }: { id: string; mode: Mode; still: number | null }) {
  const scene = SCENES[id]!;
  const { duration, Component } = scene;
  // Client only: scenes read localStorage and window, and t comes from the browser clock
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const fit = useSyncExternalStore(subscribeResize, () => (mode === "render" ? 1 : readFit()), () => 1);
  const [t, setT] = useState(still ?? 0);

  // LOOP: 0..duration, a short hold, repeat
  useEffect(() => {
    if (mode !== "loop") return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setT(Math.min(((now - start) / 1000) % (duration + HOLD), duration));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [mode, duration]);

  // RENDER: the renderer steps t itself; frame(t) returns once the DOM shows t
  useEffect(() => {
    if (mode !== "render" || !mounted) return;
    let cancelled = false;
    window.SCENE = { duration, frame: (next: number) => flushSync(() => setT(next)) };
    // Ready once fonts are in and a frame has been drawn; the timer covers hidden tabs, which skip animation frames
    const ready = () => { if (!cancelled) window.__ready = true; };
    void document.fonts.ready.then(() => {
      requestAnimationFrame(() => requestAnimationFrame(ready));
      setTimeout(ready, 250);
    });
    return () => {
      cancelled = true;
      delete window.SCENE;
      delete window.__ready;
    };
  }, [mode, mounted, duration]);

  return (
    <>
      <style>{STAGE_CSS}</style>
      <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: "#000" }}>
        <div style={{ width: FRAME_WIDTH * fit, height: FRAME_HEIGHT * fit, flexShrink: 0 }}>
          <div
            data-stage-frame
            data-scene={id}
            data-t={t.toFixed(3)}
            className="bg-background text-foreground"
            // the transform also makes the frame the box that fixed-position shell parts sit in
            style={{ position: "relative", width: FRAME_WIDTH, height: FRAME_HEIGHT, overflow: "hidden", transform: `scale(${fit})`, transformOrigin: "0 0" }}
          >
            {mounted ? <Component t={t} /> : null}
          </div>
        </div>
      </div>
    </>
  );
}
