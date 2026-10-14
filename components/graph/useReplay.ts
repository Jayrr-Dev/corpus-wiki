"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GraphNode } from "@/lib/graph";

// =====================================================================
// REPLAY (Obsidian's Animate button): shows the graph growing in the
// order things were created. While playing, `cutoff` is a time; the
// view hides every node created after it. The cutoff moves in steps,
// not every frame, so the layout has time to settle between steps.
// =====================================================================

// PACING: steps across the whole history, and the time between them
const REPLAY_STEPS = 60;
const STEP_MS = 100;

// Earliest and latest creation times, in ms
function timeSpan(nodes: readonly GraphNode[]): [number, number] | null {
  if (nodes.length === 0) return null;
  const times = nodes.map((node) => Date.parse(node.createdAt));
  return [Math.min(...times), Math.max(...times)];
}

// Replay controls for these nodes; `cutoff` is null when not playing
export function useReplay(nodes: readonly GraphNode[]) {
  const [cutoff, setCutoff] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // STOP: clears the timer and shows everything again
  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setCutoff(null);
  }, []);

  // START: steps the cutoff from the first creation time to the last
  const start = useCallback(() => {
    const span = timeSpan(nodes);
    if (!span) return;
    if (timer.current) clearInterval(timer.current);
    const [first, last] = span;
    let step = 0;
    setCutoff(first);
    timer.current = setInterval(() => {
      step += 1;
      if (step > REPLAY_STEPS) return stop();
      setCutoff(first + ((last - first) * step) / REPLAY_STEPS);
    }, STEP_MS);
  }, [nodes, stop]);

  useEffect(() => stop, [stop]);

  return { cutoff, isPlaying: cutoff !== null, start, stop };
}
