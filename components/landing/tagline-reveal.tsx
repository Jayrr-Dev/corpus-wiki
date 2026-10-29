"use client";

import { useEffect, useRef, useState } from "react";

// TAGLINE REVEAL: each word lights up from 30% to full ink, one at a time in
// reading order, as the section scrolls up through the viewport. One scroll
// listener, throttled to one read per animation frame. A line can carry its
// own colour, and `marks` colours single words (matched without punctuation).
type Line = string | { text: string; className: string };
export function TaglineReveal({ lines, marks = {} }: { lines: Line[]; marks?: Record<string, string> }) {
  const ref = useRef<HTMLDivElement>(null);
  const words = lines.map(line => (typeof line === "string" ? line : line.text).split(" "));
  const lineClass = (l: number) => { const line = lines[l]; return typeof line === "object" ? line.className : ""; };
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
    <div ref={ref} className="mx-auto max-w-[680px] text-center text-4xl font-semibold tracking-tight text-balance text-landing-ink sm:text-5xl">
      {words.map((line, l) => (
        <p key={l} className={lineClass(l)}>
          {line.map((word, w) => {
            const on = index++ < lit;
            const mark = marks[word.replace(/[^\p{L}\p{N}']/gu, "")] ?? "";
            return (
              <span key={w} className={`transition-opacity duration-500 ease-landing ${mark} ${on ? "opacity-100" : "opacity-30"}`}>
                {word}{w < line.length - 1 ? " " : ""}
              </span>
            );
          })}
        </p>
      ))}
    </div>
  );
}
