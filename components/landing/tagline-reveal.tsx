"use client";

import { useEffect, useRef, useState } from "react";

// TAGLINE REVEAL: each word lights up from 30% to full white, one at a time in
// reading order, as the section scrolls up through the viewport. One scroll
// listener, throttled to one read per animation frame.
export function TaglineReveal({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const words = lines.map(line => line.split(" "));
  const total = words.reduce((sum, line) => sum + line.length, 0);
  const [lit, setLit] = useState(0);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      // Reduced motion: every word is lit from the start
      if (reduced) return setLit(total);
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // 0 when the block's top reaches 85% down the screen, 1 when its bottom passes 40%
      const progress = (vh * 0.85 - rect.top) / (rect.height + vh * 0.45);
      setLit(Math.round(Math.min(1, Math.max(0, progress)) * total));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    frame = requestAnimationFrame(measure);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [total]);

  let index = 0;
  return (
    <div ref={ref} className="mx-auto max-w-[680px] text-center text-4xl font-semibold tracking-tight text-balance text-white sm:text-5xl">
      {words.map((line, l) => (
        <p key={l}>
          {line.map((word, w) => {
            const on = index++ < lit;
            return (
              <span key={w} className={`transition-opacity duration-500 ease-landing ${on ? "opacity-100" : "opacity-30"}`}>
                {word}{w < line.length - 1 ? " " : ""}
              </span>
            );
          })}
        </p>
      ))}
    </div>
  );
}
