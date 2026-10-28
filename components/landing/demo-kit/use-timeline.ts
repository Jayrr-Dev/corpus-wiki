"use client";

import { useEffect, useRef } from "react";

export type TimelineStep = { at: number; run: () => void };

// TIMELINE: runs each step at its time (ms from the start of the loop), then
// resets and starts over every loopMs. Stops and resets as soon as it is not
// active (off screen or reduced motion), and resumes from the start when it is.
// Steps and reset are read through a ref, so passing new functions each render
// does not restart the loop.
export function useTimeline(steps: TimelineStep[], { loopMs, active, reset }: { loopMs: number; active: boolean; reset: () => void }) {
  const latest = useRef({ steps, reset });
  // Declared before the loop's effect, so it runs first in the same commit
  useEffect(() => { latest.current = { steps, reset }; });

  useEffect(() => {
    if (!active) return;
    let timers: ReturnType<typeof setTimeout>[] = [];
    const run = () => {
      timers.forEach(clearTimeout);
      timers = [];
      latest.current.reset();
      for (const step of latest.current.steps) timers.push(setTimeout(step.run, step.at));
      timers.push(setTimeout(run, loopMs));
    };
    run();
    return () => {
      timers.forEach(clearTimeout);
      latest.current.reset();
    };
  }, [active, loopMs]);
}
