"use client";

import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";

// IN VIEW: true while the element is on screen, false once it leaves, so a demo
// plays only while someone can see it and stops costing anything off screen.
export function useInView(ref: RefObject<Element | null>, rootMargin = "0px 0px -10% 0px") {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setInView(!!entry?.isIntersecting), { rootMargin });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, rootMargin]);

  return inView;
}

// REDUCED MOTION: true when the visitor asked the system for less motion; demos
// then render one still, finished frame instead of looping.
const REDUCE = "(prefers-reduced-motion: reduce)";
function subscribeReduced(onChange: () => void) {
  const query = window.matchMedia(REDUCE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
export function useReducedMotion() {
  // The server can't know, so it renders the moving version; the client corrects on hydration
  return useSyncExternalStore(subscribeReduced, () => window.matchMedia(REDUCE).matches, () => false);
}
