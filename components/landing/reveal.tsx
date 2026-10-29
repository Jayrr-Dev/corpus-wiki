"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// SCROLL REVEAL: the block rises 32px and fades in the first time it enters the
// viewport, then stays. Reduced motion keeps the fade and drops the movement.
// The server markup plays the entrance in CSS (.landing-reveal-in), so the block
// shows even when JavaScript is slow or fails. After hydration, only blocks
// still below the fold are hidden again to wait for the scroll.
type Phase = "css" | "waiting" | "shown";

export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("css");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Already on screen (or above it): the CSS entrance has it covered
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return;
    setPhase("waiting");
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setPhase("shown");
        observer.disconnect();
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={phase === "css" ? { animationDelay: `${delay}ms` } : { transitionDelay: `${delay}ms` }}
      className={cn(
        phase === "css"
          ? "landing-reveal-in"
          : ["transition duration-700 ease-landing motion-reduce:translate-y-0", phase === "shown" ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"],
        className,
      )}
    >
      {children}
    </div>
  );
}
